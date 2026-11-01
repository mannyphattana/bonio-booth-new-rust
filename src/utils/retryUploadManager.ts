/**
 * Retry Upload Manager
 *
 * ทำงานเป็น background service สำหรับ retry upload sessions ที่ล้มเหลว
 * โดยใช้ไฟล์ที่บันทึกไว้ใน C:\boniobooth\Saved_Photos\ และ
 * pending records ใน localStorage
 *
 * Flow:
 * 1. ดึง retryable pending records จาก localStorage
 * 2. สำหรับแต่ละ record ตรวจสอบว่าไฟล์ยังมีอยู่บน disk
 * 3. เรียก create_presign_upload ด้วย transactionId เดิม
 * 4. Upload แต่ละไฟล์ไปยัง presign URLs
 * 5. เรียก confirm_upload
 * 6. ถ้าสำเร็จ: ลบ record ออก | ถ้าล้มเหลว: เพิ่ม retryCount
 */

import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "./appLogger";
import {
  getRetryablePending,
  removePendingUpload,
  incrementRetryCount,
  isUploadActive,
  addPendingUpload,
  MAX_RETRY_COUNT,
  type PendingUploadRecord,
  type PendingUploadFile,
} from "./pendingUploadStore";

const CTX = "[RetryUpload]";

/**
 * รอบ retry ที่กำลังรันอยู่ — ป้องกัน concurrent retry runs
 * คนที่เรียกระหว่างนั้นจะได้ promise ตัวเดียวกันไปรอ (รอบนี้หยิบ record ที่เพิ่งเข้าคิวไปทำด้วย)
 */
let _currentRun: Promise<void> | null = null;

/** ยิงไฟล์เดียวไม่ขึ้น → ลองซ้ำทันทีอีกกี่ครั้ง (presign URL อยู่ได้ 30 นาที ใช้ซ้ำได้) */
const FILE_RETRY_DELAYS_MS = [2000, 5000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ตรวจสอบว่าไฟล์มีอยู่บน disk หรือเปล่า
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    const exists: boolean = await invoke("check_file_exists", { path });
    return exists;
  } catch {
    return false;
  }
}

/**
 * Retry upload สำหรับ 1 pending record
 * Returns true ถ้าสำเร็จ, false ถ้าล้มเหลว
 */
async function retryOneRecord(record: PendingUploadRecord): Promise<boolean> {
  appLogger.info(
    CTX,
    `Retrying txId=${record.txId} retryCount=${record.retryCount} files=${record.files.length}`
  );

  // 1. กรองเฉพาะไฟล์ที่ยังมีอยู่บน disk
  const availableFiles: PendingUploadFile[] = [];
  for (const f of record.files) {
    const exists = await fileExists(f.localPath);
    if (exists) {
      availableFiles.push(f);
    } else {
      appLogger.warn(CTX, `File not found on disk: ${f.localPath}`);
    }
  }

  if (availableFiles.length === 0) {
    appLogger.warn(
      CTX,
      `All files missing for txId=${record.txId} — giving up`
    );
    // ไฟล์หายหมด ไม่มีประโยชน์ retry ต่อ
    return false;
  }

  // 2. สร้าง filesMeta สำหรับ presign API (video ใช้ type "video", รูปอื่นๆ ใช้ "photo")
  const presignFiles = availableFiles.map((f) => ({
    type: f.type === "video" ? "video" : "photo",
    contentType: f.contentType,
  }));

  // 3. สร้าง presign session ใหม่
  let presignResult: any;
  try {
    presignResult = await invoke("create_presign_upload", {
      transactionId: record.transactionId,
      files: presignFiles,
      transactionCode: record.transactionCode || null,
    });
  } catch (err) {
    appLogger.error(
      CTX,
      `create_presign_upload failed for txId=${record.txId}:`,
      err
    );
    return false;
  }

  const responseData = presignResult?.data || presignResult;
  if (!presignResult?.success || !responseData?.uploadUrls) {
    appLogger.warn(
      CTX,
      `create_presign_upload returned no uploadUrls for txId=${record.txId}`
    );
    return false;
  }

  const sessionId: string = responseData.photoSession?.id || "";
  const uploadUrls: any[] = responseData.uploadUrls || [];

  if (!sessionId || uploadUrls.length === 0) {
    appLogger.warn(
      CTX,
      `No sessionId or uploadUrls for txId=${record.txId}`
    );
    return false;
  }

  appLogger.info(
    CTX,
    `Got presign for txId=${record.txId} sessionId=${sessionId} urls=${uploadUrls.length}`
  );

  // 4. แยก photo / video URLs
  const photoUrls = uploadUrls
    .filter((u: any) => u.type === "photo")
    .sort((a: any, b: any) => a.order - b.order);
  const videoUrls = uploadUrls
    .filter((u: any) => u.type === "video")
    .sort((a: any, b: any) => a.order - b.order);

  const photoFiles = availableFiles.filter((f) => f.type !== "video");
  const videoFiles = availableFiles.filter((f) => f.type === "video");

  const jobs = [
    ...photoFiles.slice(0, photoUrls.length).map((file, i) => ({ file, urlInfo: photoUrls[i], type: "photo" })),
    ...videoFiles.slice(0, videoUrls.length).map((file, i) => ({ file, urlInfo: videoUrls[i], type: "video" })),
  ];

  const uploadedFiles: { key: string; type: string; order: number }[] = [];
  const failedFiles: PendingUploadFile[] = [];

  // 5. Upload ทีละไฟล์ (รูปก่อน วิดีโอทีหลัง) — เน็ตหลุดมักแค่ไม่กี่วินาที เลยลองซ้ำทันทีก่อนยอมแพ้
  for (const { file, urlInfo, type } of jobs) {
    for (let attempt = 0; ; attempt++) {
      try {
        await invoke("upload_to_presigned_url", {
          url: urlInfo.uploadUrl,
          filePath: file.localPath,
          contentType: file.contentType,
        });
        uploadedFiles.push({ key: urlInfo.key, type, order: urlInfo.order });
        appLogger.info(CTX, `Uploaded ${file.type} OK — key=${urlInfo.key}`);
        break;
      } catch (err) {
        const delay = FILE_RETRY_DELAYS_MS[attempt];
        appLogger.error(
          CTX,
          `Upload ${file.type} failed (path=${file.localPath}, attempt ${attempt + 1}):`,
          err
        );
        if (delay === undefined) {
          failedFiles.push(file);
          break;
        }
        await sleep(delay);
      }
    }
  }

  if (uploadedFiles.length === 0) {
    appLogger.warn(
      CTX,
      `No files uploaded for txId=${record.txId}`
    );
    return false;
  }

  // 6. ขาดไฟล์ → ยังไม่ confirm ให้รอบหน้ายิงใหม่ทั้งชุด
  // confirm ไปตอนนี้ backend จะเรียงลำดับใหม่จากไฟล์ที่มี (รูปเฟรมหาย = รูปดิบใบแรกขึ้นเป็นรูปหลัก)
  // แล้ว record ถูกลบจากคิว ไม่มีใครยิงไฟล์ที่ขาดอีกเลย
  // ยกเว้นรอบสุดท้าย: confirm เท่าที่มีดีกว่าไม่มีอะไรให้ลูกค้าเลย ถ้ารูปเฟรม (ใบแรก) ขึ้นแล้ว
  if (failedFiles.length > 0) {
    const isLastAttempt = record.retryCount + 1 >= MAX_RETRY_COUNT;
    const frameUploaded = photoFiles.length > 0 && !failedFiles.includes(photoFiles[0]);
    appLogger.warn(
      CTX,
      `${failedFiles.length}/${jobs.length} file(s) still failing for txId=${record.txId}: ${failedFiles.map((f) => f.localPath).join(", ")}`
    );
    if (!isLastAttempt || !frameUploaded) {
      return false;
    }
    appLogger.warn(CTX, `Last attempt for txId=${record.txId} — confirming the files that did upload`);
  }

  // 7. Confirm upload
  try {
    await invoke("confirm_upload", {
      sessionId,
      uploadedFiles,
    });
    appLogger.info(
      CTX,
      `confirm_upload OK for txId=${record.txId} files=${uploadedFiles.length}`
    );
    return true;
  } catch (err) {
    appLogger.error(
      CTX,
      `confirm_upload failed for txId=${record.txId}:`,
      err
    );
    return false;
  }
}

/**
 * Main entry point — เรียกจาก App.tsx เป็น background task
 * idempotent: ถ้ามีรอบที่รันอยู่แล้ว จะคืน promise ของรอบนั้นแทนการเริ่มรอบใหม่
 */
export function retryPendingUploads(): Promise<void> {
  if (_currentRun) {
    appLogger.info(CTX, "Already retrying — new records will be picked up by the current cycle");
    return _currentRun;
  }

  _currentRun = runRetryCycle().finally(() => {
    _currentRun = null;
  });
  return _currentRun;
}

async function runRetryCycle(): Promise<void> {
  // txId ที่รอบนี้หยิบไปแล้ว — กันการยิง record เดิมซ้ำในรอบเดียว
  const attempted = new Set<string>();
  let started = false;

  // อ่านคิวใหม่ทุกครั้งที่ทำเสร็จหนึ่ง record: dashboard กด Re-upload หลายอันติดกัน
  // อันที่เข้ามาระหว่างรอบจะได้ทำต่อเลย ไม่ต้องรอรอบ 10 นาที
  for (;;) {
    const record = getRetryablePending().find((r) => !attempted.has(r.txId));
    if (!record) break;
    attempted.add(record.txId);

    if (!started) {
      started = true;
      appLogger.info(CTX, "Starting retry cycle");
    }

    // ข้าม record ที่กำลังอัพโหลดสดอยู่ในหน้า PhotoResult
    // ป้องกันการอัพซ้ำจากการชนกันระหว่าง upload ปกติกับ retry cycle
    if (isUploadActive(record.txId)) {
      appLogger.info(
        CTX,
        `Skipping txId=${record.txId} — upload currently in-flight`
      );
      continue;
    }

    const success = await retryOneRecord(record);
    if (success) {
      removePendingUpload(record.txId);
      appLogger.info(CTX, `✅ Retry success — removed txId=${record.txId}`);
    } else {
      incrementRetryCount(record.txId);
      appLogger.warn(
        CTX,
        `Retry failed — txId=${record.txId} retryCount now ${record.retryCount + 1}`
      );
    }
  }

  if (started) {
    appLogger.info(CTX, `Retry cycle complete — ${attempted.size} record(s)`);
  }
}

/**
 * อัปโหลดไฟล์ของ transaction เดิมซ้ำ โดยดึงจากไฟล์ที่ยังอยู่บนดิสก์ของตู้
 *
 * ใช้ตอน dashboard สั่งมาทาง SSE (`request-reupload`) — ไม่ต้องพึ่ง pending record
 * เดิมซึ่งอาจถูกลบไปแล้ว แต่ประกอบรายการใหม่จากชื่อไฟล์ใน Saved_Photos ตรงๆ
 *
 * ยิงทันทีไม่รอรอบ 10 นาที เพราะเป็นคำสั่งที่คนกดเองและกำลังรอดูผล
 */
export async function reuploadTransactionFromDisk(
  transactionId: string,
): Promise<{ success: boolean; message: string; files: number }> {
  const txId = (transactionId || "").trim();
  if (!txId) {
    return { success: false, message: "transactionId is empty", files: 0 };
  }

  appLogger.info(CTX, `Re-upload requested for transaction ${txId}`);

  let saved: Array<{
    file_type: string;
    local_path: string;
    order: number;
    content_type: string;
  }>;
  try {
    saved = await invoke("list_saved_transaction_files", {
      transactionId: txId,
    });
  } catch (err) {
    appLogger.error(CTX, `list_saved_transaction_files failed for ${txId}:`, err);
    return { success: false, message: `ไม่สามารถอ่านไฟล์ในเครื่อง: ${err}`, files: 0 };
  }

  if (!saved || saved.length === 0) {
    appLogger.warn(CTX, `No saved files on disk for transaction ${txId}`);
    return {
      success: false,
      message: "ไม่พบไฟล์ของ transaction นี้ในเครื่อง (อาจถูกลบไปแล้ว)",
      files: 0,
    };
  }

  const record: PendingUploadRecord = {
    txId,
    transactionId: txId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    files: saved.map((f) => ({
      type: f.file_type as PendingUploadFile["type"],
      localPath: f.local_path,
      order: f.order,
      contentType: f.content_type,
    })),
  };

  addPendingUpload(record);
  appLogger.info(
    CTX,
    `Queued re-upload for ${txId} — ${record.files.length} file(s) found on disk`,
  );

  // ยิงรอบ retry ทันที — ถ้ามีรอบรันอยู่ รอบนั้นจะหยิบ record นี้ไปทำต่อเอง
  await retryPendingUploads();
  // แต่ถ้ารอบนั้นทำ tx นี้ไปแล้วก่อนที่เราจะเพิ่ม record ใหม่ (กดซ้ำระหว่างรอบ)
  // record ใหม่จะยังไม่ถูกแตะ (retryCount ยังเป็น 0) → เริ่มอีกรอบให้
  if (getRetryablePending().some((r) => r.txId === txId && r.retryCount === 0)) {
    await retryPendingUploads();
  }

  const stillPending = getRetryablePending().some((r) => r.txId === txId);
  return stillPending
    ? {
        success: false,
        message: "อัปโหลดซ้ำยังไม่สำเร็จ ระบบจะลองอีกใน 10 นาที",
        files: record.files.length,
      }
    : {
        success: true,
        message: "อัปโหลดซ้ำสำเร็จ ลิงก์เดิมของลูกค้าใช้งานได้แล้ว",
        files: record.files.length,
      };
}
