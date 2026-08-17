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
  type PendingUploadRecord,
  type PendingUploadFile,
} from "./pendingUploadStore";

const CTX = "[RetryUpload]";

/** ป้องกัน concurrent retry runs */
let _isRetrying = false;

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

  const uploadedFiles: { key: string; type: string; order: number }[] = [];

  // 5. Upload photo files
  for (let i = 0; i < photoFiles.length && i < photoUrls.length; i++) {
    const file = photoFiles[i];
    const urlInfo = photoUrls[i];
    try {
      await invoke("upload_to_presigned_url", {
        url: urlInfo.uploadUrl,
        filePath: file.localPath,
        contentType: file.contentType,
      });
      uploadedFiles.push({
        key: urlInfo.key,
        type: "photo",
        order: urlInfo.order,
      });
      appLogger.info(
        CTX,
        `Uploaded ${file.type} OK — key=${urlInfo.key}`
      );
    } catch (err) {
      appLogger.error(
        CTX,
        `Upload ${file.type} failed (path=${file.localPath}):`,
        err
      );
    }
  }

  // 6. Upload video file
  for (let i = 0; i < videoFiles.length && i < videoUrls.length; i++) {
    const file = videoFiles[i];
    const urlInfo = videoUrls[i];
    try {
      await invoke("upload_to_presigned_url", {
        url: urlInfo.uploadUrl,
        filePath: file.localPath,
        contentType: file.contentType,
      });
      uploadedFiles.push({
        key: urlInfo.key,
        type: "video",
        order: urlInfo.order,
      });
      appLogger.info(CTX, `Uploaded video OK — key=${urlInfo.key}`);
    } catch (err) {
      appLogger.error(
        CTX,
        `Upload video failed (path=${file.localPath}):`,
        err
      );
    }
  }

  if (uploadedFiles.length === 0) {
    appLogger.warn(
      CTX,
      `No files uploaded for txId=${record.txId}`
    );
    return false;
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
 * idempotent: ถ้ามี retry อยู่แล้วจะ skip
 */
export async function retryPendingUploads(): Promise<void> {
  if (_isRetrying) {
    appLogger.info(CTX, "Already retrying — skipping");
    return;
  }

  const pending = getRetryablePending();
  if (pending.length === 0) {
    return;
  }

  _isRetrying = true;
  appLogger.info(CTX, `Starting retry cycle — ${pending.length} pending record(s)`);

  try {
    for (const record of pending) {
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
  } finally {
    _isRetrying = false;
  }

  appLogger.info(CTX, "Retry cycle complete");
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

  // ยิงรอบ retry ทันที (ตัว guard ภายในกันการรันซ้อนอยู่แล้ว)
  await retryPendingUploads();

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
