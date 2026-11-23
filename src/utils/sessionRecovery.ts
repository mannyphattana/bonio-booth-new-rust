/**
 * Session Recovery — จำ session ที่ลูกค้าจ่ายเงินแล้ว เผื่อโปรแกรมค้าง/เครื่องดับกลางทาง
 *
 * ทุกหน้าหลังจ่ายเงินบันทึก checkpoint (ขั้นที่อยู่ + transactionId/referenceId + ข้อมูลที่ต้องใช้ทำต่อ)
 * ลงไฟล์ C:\boniobooth\Recovery\state.json ผ่าน Rust (fsync — ไฟดับก็ไม่หาย) และต่อท้าย journal.jsonl
 * ทุก step ไว้ไล่ย้อนหลัง
 *
 * เปิดโปรแกรมใหม่ → runStartupRecovery() เช็คครั้งเดียว แล้วพากลับไปทำต่อ:
 *   รอ QR (payment_pending) → เช็คสถานะกับ Ksher: จ่ายแล้วไปหน้าเลือกกรอบ / ยังไม่จ่ายปิด order ทิ้ง
 *   จ่ายแล้ว (paid)         → หน้าเลือกกรอบ
 *   เลือกกรอบแล้ว/กำลังถ่าย  → หน้าเตรียมถ่าย (เริ่มถ่ายใหม่ทั้งชุด)
 *   ถ่ายเสร็จ (shot)          → หน้าเลือกรูปลงช่อง ใช้รูป+วิดีโอที่เก็บไว้
 *   เลือกช่องแล้ว             → หน้าเลือก filter
 *   หน้าผลลัพธ์ (result)      → ยังพิมพ์ไม่ออก: กลับหน้าผลลัพธ์แล้วพิมพ์ใหม่ / พิมพ์แล้ว: จบ (upload อยู่ในคิว retry)
 *
 * session จบ (กลับหน้า Home) → ลบ checkpoint ทิ้ง ยกเว้นพิมพ์ไม่ออก — เก็บไว้ให้เปิดโปรแกรมใหม่แล้วพิมพ์ซ้ำ
 */

import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "./appLogger";
import { logError } from "./logger";
import { SESSION_RECOVERY } from "../config/appConfig";
import type { Capture } from "../App";

const CTX = "[SessionRecovery]";

export type RecoveryStage =
  | "payment_pending"
  | "paid"
  | "frame_selected"
  | "shot"
  | "slots_selected"
  | "result";

const STAGE_RANK: Record<RecoveryStage, number> = {
  payment_pending: 0,
  paid: 1,
  frame_selected: 2,
  shot: 3,
  slots_selected: 4,
  result: 5,
};

interface SavedCapture {
  photoPath: string;
  previewPath: string;
  /** "" = ไม่มีวิดีโอของรูปนี้ (หน้าผลลัพธ์มี fallback อยู่แล้ว) */
  videoPath: string;
}

export interface RecoveryRecord {
  version: 1;
  /** referenceId ถ้ามี ไม่งั้น transactionId */
  id: string;
  transactionId: string;
  referenceId: string;
  stage: RecoveryStage;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
  /** state จากหน้าจ่ายเงิน (จำนวนรูป, ราคา, วิธีจ่าย, คูปอง, ID) — ไม่มีรูป */
  base: Record<string, any>;
  selectedFrame?: any;
  captures?: SavedCapture[];
  captureVideoDiagnostics?: any[];
  selectedCaptureIndexes?: number[];
  selectedFilter?: any;
  /** รูปที่ผ่าน filter แล้ว เรียงตามช่องในกรอบ */
  resultPhotoPaths?: string[];
  printDone?: boolean;
  printFailed?: boolean;
  resumeCount: number;
  history: Array<{ stage: string; at: string; note?: string }>;
}

/** key ที่เป็นรูป/ข้อมูลใหญ่ — ไม่เก็บใน base (เก็บเป็นไฟล์แยก) */
const HEAVY_KEYS = new Set([
  "captures",
  "frameCaptures",
  "selectedFrame",
  "captureVideoDiagnostics",
  "selectedCaptureIndexes",
  "selectedFilter",
  "resumedFrom",
]);

let current: RecoveryRecord | null = null;
let writeChain: Promise<void> = Promise.resolve();

function now(): string {
  return new Date().toISOString();
}

function idOf(state: any): string {
  return String(state?.referenceId || state?.transactionId || "");
}

export function transactionCodeOf(rec: { referenceId?: string; transactionId?: string }): string {
  const ref = rec.referenceId || "";
  if (ref) return ref.startsWith("TXN-") ? ref : ref.replace(/^MCH-/, "TXN-");
  return rec.transactionId || "";
}

function pickBase(state: any): Record<string, any> {
  const base: Record<string, any> = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (HEAVY_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 4096) continue; // กัน data URL หลุดเข้ามา
    base[k] = v;
  }
  return base;
}

/** ต่อคิวเขียน — checkpoint ต้องลงดิสก์ตามลำดับที่เกิด */
function enqueue(task: () => Promise<void>): Promise<void> {
  writeChain = writeChain.then(task).catch((e) => {
    appLogger.error(CTX, `write failed: ${e}`);
  });
  return writeChain;
}

async function journal(event: string, rec: RecoveryRecord | null, extra?: Record<string, any>) {
  const line = {
    at: now(),
    event,
    id: rec?.id,
    transactionId: rec?.transactionId,
    referenceId: rec?.referenceId,
    stage: rec?.stage,
    ...extra,
  };
  try {
    await invoke("recovery_journal", { line: JSON.stringify(line) });
  } catch (e) {
    appLogger.warn(CTX, `journal write failed: ${e}`);
  }
}

async function persist(rec: RecoveryRecord) {
  rec.updatedAt = now();
  await invoke("recovery_save_state", { stateJson: JSON.stringify(rec) });
}

async function clearFiles() {
  await invoke("recovery_clear");
}

/**
 * บันทึกว่า session อยู่ขั้นไหน — เรียกตอนเข้าแต่ละหน้า
 * id ไม่ตรงกับ record เดิม = ลูกค้าคนใหม่ → ทิ้งของเดิมแล้วเริ่ม record ใหม่
 */
export function checkpoint(
  stage: RecoveryStage,
  state: any,
  patch: Partial<RecoveryRecord> = {},
  note?: string,
): Promise<void> {
  const id = idOf(state);
  if (!id) {
    appLogger.warn(CTX, `checkpoint "${stage}" skipped — no transactionId/referenceId in state`);
    return Promise.resolve();
  }

  return enqueue(async () => {
    if (!current || current.id !== id) {
      if (current) {
        await journal("superseded", current, { by: id });
      }
      await clearFiles();
      current = {
        version: 1,
        id,
        transactionId: String(state.transactionId || ""),
        referenceId: String(state.referenceId || ""),
        stage,
        createdAt: now(),
        updatedAt: now(),
        base: pickBase(state),
        resumeCount: 0,
        history: [],
      };
    }

    const rec = current;
    rec.stage = stage;
    rec.transactionId = String(state.transactionId || rec.transactionId || "");
    rec.referenceId = String(state.referenceId || rec.referenceId || "");
    // base เก็บจากหน้าที่ยังไม่มีรูป เท่านั้น (state หลังจากนั้นมีแต่ของใหญ่เพิ่มเข้ามา)
    if (STAGE_RANK[stage] <= STAGE_RANK.paid) rec.base = pickBase(state);
    if (state.selectedFrame) rec.selectedFrame = state.selectedFrame;
    Object.assign(rec, patch);
    if (stage === "paid" && !rec.paidAt) rec.paidAt = now();
    rec.history.push({ stage, at: now(), ...(note ? { note } : {}) });
    if (rec.history.length > 50) rec.history.splice(0, rec.history.length - 50);

    await persist(rec);
    await journal("checkpoint", rec, {
      note,
      paymentMethod: rec.base.paymentMethod,
      quantity: rec.base.quantity,
      totalPrice: rec.base.totalPrice,
      couponCode: rec.base.couponCode,
      frame: rec.selectedFrame?.name || rec.selectedFrame?._id,
    });
    appLogger.info(CTX, `checkpoint ${stage} — id=${rec.id} tx=${rec.transactionId}${note ? ` (${note})` : ""}`);
  });
}

/** แก้ record ของ session id นี้ (ถ้ายังเป็น session ปัจจุบันอยู่) */
function update(id: string, mutate: (rec: RecoveryRecord) => string | void): Promise<void> {
  return enqueue(async () => {
    if (!current || current.id !== id) return;
    const event = mutate(current);
    await persist(current);
    if (event) await journal(event, current);
  });
}

function extOf(dataUrl: string): string {
  return dataUrl.startsWith("data:image/png") ? "png" : "jpg";
}

async function saveImage(dataUrl: string, filename: string): Promise<string> {
  return invoke<string>("recovery_save_image", { imageDataBase64: dataUrl, filename });
}

/**
 * เก็บรูปที่ถ่าย + วิดีโอ ลงดิสก์ แล้วเลื่อน checkpoint เป็น "shot"
 * (ระหว่างยังเก็บไม่เสร็จ ถ้าพัง → เปิดใหม่จะเริ่มถ่ายใหม่)
 */
export async function saveCaptures(
  state: any,
  captures: Capture[],
  captureVideoDiagnostics: any[] = [],
): Promise<void> {
  const id = idOf(state);
  if (!id || captures.length === 0) return;
  if (current?.id === id && current.captures?.length === captures.length) return; // เก็บไว้แล้ว

  const started = Date.now();
  try {
    const saved: SavedCapture[] = [];
    for (let i = 0; i < captures.length; i++) {
      const cap = captures[i];
      const photoPath = cap.photo ? await saveImage(cap.photo, `photo_${i}.${extOf(cap.photo)}`) : "";
      const previewPath =
        cap.photoPreview && cap.photoPreview !== cap.photo
          ? await saveImage(cap.photoPreview, `preview_${i}.${extOf(cap.photoPreview)}`)
          : "";
      let videoPath = "";
      if (cap.videoPath) {
        try {
          videoPath = await invoke<string>("recovery_copy_file", {
            sourcePath: cap.videoPath,
            filename: `video_${i}.webm`,
          });
        } catch (e) {
          appLogger.warn(CTX, `copy video ${i} failed — keeping temp path: ${e}`);
          videoPath = cap.videoPath;
        }
      }
      saved.push({ photoPath, previewPath, videoPath });
    }

    await update(id, (rec) => {
      rec.captures = saved;
      rec.captureVideoDiagnostics = captureVideoDiagnostics;
      if (STAGE_RANK[rec.stage] < STAGE_RANK.shot) {
        rec.stage = "shot";
        rec.history.push({ stage: "shot", at: now(), note: `${saved.length} captures saved` });
      }
      return "captures_saved";
    });
    appLogger.info(CTX, `saved ${saved.length} captures for recovery in ${Date.now() - started}ms`);
  } catch (e) {
    appLogger.error(CTX, `saveCaptures failed: ${e}`);
    logError("recovery_save_captures_failed", `id=${id}: ${String(e)}`, undefined, "warning");
  }
}

/**
 * เก็บรูปที่ผ่าน filter แล้ว (ตามช่องในกรอบ) แล้วเลื่อน checkpoint เป็น "result"
 * (ระหว่างยังเก็บไม่เสร็จ ถ้าพัง → เปิดใหม่จะกลับไปหน้าเลือก filter)
 */
export async function saveResult(state: any, frameCaptures: Capture[]): Promise<void> {
  const id = idOf(state);
  if (!id || frameCaptures.length === 0) return;
  if (
    current?.id === id &&
    current.stage === "result" &&
    current.resultPhotoPaths?.length === frameCaptures.length
  ) {
    return; // กลับมาจากการกู้ session — มีไฟล์อยู่แล้ว
  }

  try {
    const paths: string[] = [];
    for (let i = 0; i < frameCaptures.length; i++) {
      const photo = frameCaptures[i].photo;
      paths.push(photo ? await saveImage(photo, `result_${i}.${extOf(photo)}`) : "");
    }
    await update(id, (rec) => {
      rec.resultPhotoPaths = paths;
      rec.selectedFilter = state.selectedFilter ?? null;
      rec.selectedCaptureIndexes = state.selectedCaptureIndexes || rec.selectedCaptureIndexes;
      rec.stage = "result";
      // ไม่แตะ printDone/printFailed — การพิมพ์เริ่ม/จบได้ก่อนเก็บรูปเสร็จ (markPrintStarted/markPrintResult เป็นคนตั้ง)
      rec.history.push({ stage: "result", at: now(), note: `filter=${state.selectedFilter?.id || "none"}` });
      return "result_saved";
    });
  } catch (e) {
    appLogger.error(CTX, `saveResult failed: ${e}`);
    logError("recovery_save_result_failed", `id=${id}: ${String(e)}`, undefined, "warning");
  }
}

/** เริ่มพิมพ์ — ล้างผลรอบก่อน (กรณีกู้ session มาพิมพ์ซ้ำ) ระหว่างพิมพ์อยู่ไม่ถือว่าพิมพ์ไม่ออก */
export function markPrintStarted(state: any): Promise<void> {
  const id = idOf(state);
  if (!id) return Promise.resolve();
  return update(id, (rec) => {
    rec.printDone = false;
    rec.printFailed = false;
    return "print_started";
  });
}

/** ผลการพิมพ์ของหน้าผลลัพธ์ — ใช้ตัดสินว่าเปิดใหม่ต้องพิมพ์ซ้ำไหม */
export function markPrintResult(state: any, ok: boolean, detail?: string): Promise<void> {
  const id = idOf(state);
  if (!id) return Promise.resolve();
  return update(id, (rec) => {
    rec.printDone = ok;
    rec.printFailed = !ok;
    rec.history.push({ stage: rec.stage, at: now(), note: ok ? "print done" : `print failed: ${detail || ""}` });
    return ok ? "print_done" : "print_failed";
  });
}

/**
 * กลับหน้า Home = session จบ → ลบ checkpoint
 * ยกเว้นพิมพ์ไม่ออก: เก็บไว้ เปิดโปรแกรมใหม่ (หลังแก้เครื่องพิมพ์) จะพากลับไปพิมพ์ให้
 */
export function endSession(reason: string): Promise<void> {
  return enqueue(async () => {
    const rec = current;
    if (!rec) return;
    current = null;

    if (rec.stage === "result" && rec.printFailed && !rec.printDone) {
      await journal("ended_kept_for_reprint", rec, { reason });
      appLogger.warn(CTX, `session ${rec.id} ended without a print — kept for reprint on next start`);
      return;
    }
    await clearFiles();
    await journal("ended", rec, { reason, printDone: rec.printDone ?? null });
    appLogger.info(CTX, `session ${rec.id} ended (${reason}) — recovery cleared`);
  });
}

export interface ResumeTarget {
  route: string;
  state: Record<string, any>;
}

async function readImage(path: string): Promise<string> {
  return invoke<string>("recovery_read_image", { path });
}

async function fileExists(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    return await invoke<boolean>("check_file_exists", { path });
  } catch {
    return false;
  }
}

/** โหลดรูปที่ถ่ายไว้กลับมาเป็น Capture[] — ขาดรูปไหนไป = กู้ไม่ได้ (null) */
async function loadCaptures(rec: RecoveryRecord): Promise<Capture[] | null> {
  if (!rec.captures?.length) return null;
  const out: Capture[] = [];
  for (const c of rec.captures) {
    if (!c.photoPath) return null;
    try {
      const photo = await readImage(c.photoPath);
      const photoPreview = c.previewPath ? await readImage(c.previewPath).catch(() => photo) : photo;
      const videoPath = (await fileExists(c.videoPath)) ? c.videoPath : "";
      out.push({ photo, photoPreview, video: "", videoPath });
    } catch (e) {
      appLogger.warn(CTX, `load capture failed (${c.photoPath}): ${e}`);
      return null;
    }
  }
  return out;
}

function isPaidSuccess(result: any): boolean {
  const s = result?.data?.status || result?.data?.trade_state;
  return s === "SUCCESS" || s === "success";
}

/**
 * ตัดสินว่าจะพาไปหน้าไหน — ถ้าข้อมูลขั้นปัจจุบันไม่ครบจะถอยไปขั้นก่อนหน้าที่ทำต่อได้
 */
async function buildTarget(rec: RecoveryRecord): Promise<ResumeTarget | null> {
  const base: Record<string, any> = {
    ...rec.base,
    transactionId: rec.transactionId,
    referenceId: rec.referenceId,
    resumedFrom: rec.stage,
  };

  if (rec.stage === "payment_pending") {
    if (!rec.referenceId) return null;
    let result: any;
    try {
      result = await invoke("check_payment_status", { mchOrderNo: rec.referenceId });
    } catch (e) {
      // เช็คไม่ได้ ไม่รู้ว่าจ่ายหรือยัง — เก็บ record ไว้ให้รอบหน้าเช็คใหม่ ไม่ปิด order
      appLogger.error(CTX, `payment status check failed for ${rec.referenceId}: ${e}`);
      throw new Error("payment status unknown");
    }
    if (!isPaidSuccess(result)) {
      await invoke("close_payment", { mchOrderNo: rec.referenceId }).catch(() => {});
      await journal("pending_payment_not_paid", rec);
      return null;
    }
    const txId =
      result.data.transactionId || result.data.data?.transactionId || result.data.transaction_id || rec.transactionId;
    rec.transactionId = String(txId || rec.referenceId);
    rec.paidAt = now();
    await journal("pending_payment_found_paid", rec);
    return {
      route: "/frame-selection",
      state: { ...base, paymentMethod: base.paymentMethod || "qrcode", transactionId: rec.transactionId },
    };
  }

  if (rec.stage === "result") {
    if (rec.printDone) return null; // พิมพ์ออกแล้ว — upload อยู่ในคิว retry แล้ว จบ
    const captures = await loadCaptures(rec);
    const resultPaths = rec.resultPhotoPaths || [];
    if (captures && resultPaths.length > 0 && resultPaths.every((p) => !!p)) {
      try {
        const indexes = rec.selectedCaptureIndexes || [];
        const frameCaptures: Capture[] = [];
        for (let i = 0; i < resultPaths.length; i++) {
          const photo = await readImage(resultPaths[i]);
          const src = captures[indexes[i]] || captures[i];
          frameCaptures.push({ photo, photoPreview: photo, video: "", videoPath: src?.videoPath || "" });
        }
        return {
          route: "/photo-result",
          state: {
            ...base,
            selectedFrame: rec.selectedFrame,
            captures,
            captureVideoDiagnostics: rec.captureVideoDiagnostics || [],
            selectedCaptureIndexes: indexes,
            frameCaptures,
            selectedFilter: rec.selectedFilter ?? null,
          },
        };
      } catch (e) {
        appLogger.warn(CTX, `load result photos failed: ${e} — falling back to filter page`);
      }
    }
    rec.stage = "slots_selected";
  }

  if (rec.stage === "slots_selected") {
    const captures = await loadCaptures(rec);
    const indexes = rec.selectedCaptureIndexes || [];
    if (captures && indexes.length > 0 && indexes.every((i) => !!captures[i])) {
      return {
        route: "/apply-filter",
        state: {
          ...base,
          selectedFrame: rec.selectedFrame,
          captures,
          captureVideoDiagnostics: rec.captureVideoDiagnostics || [],
          selectedCaptureIndexes: indexes,
          frameCaptures: indexes.map((i) => captures[i]),
        },
      };
    }
    rec.stage = "shot";
  }

  if (rec.stage === "shot") {
    const captures = await loadCaptures(rec);
    if (captures) {
      return {
        route: "/slot-selection",
        state: {
          ...base,
          selectedFrame: rec.selectedFrame,
          captures,
          captureVideoDiagnostics: rec.captureVideoDiagnostics || [],
        },
      };
    }
    rec.stage = "frame_selected";
  }

  if (rec.stage === "frame_selected" && rec.selectedFrame) {
    // ถ่ายค้างกลางทาง → เริ่มถ่ายใหม่ทั้งชุด
    return { route: "/prepare-shooting", state: { ...base, selectedFrame: rec.selectedFrame } };
  }

  return { route: "/frame-selection", state: base };
}

let startupPromise: Promise<ResumeTarget | null> | null = null;

/** เช็คครั้งเดียวต่อการเปิดโปรแกรม — เรียกซ้ำได้ ได้ผลเดิม (รอบหลังคืน null) */
export function runStartupRecovery(): Promise<ResumeTarget | null> {
  if (startupPromise) return startupPromise.then(() => null);
  startupPromise = doStartupRecovery().catch((e) => {
    appLogger.error(CTX, `startup recovery failed: ${e}`);
    return null;
  });
  return startupPromise;
}

async function doStartupRecovery(): Promise<ResumeTarget | null> {
  const raw = await invoke<string | null>("recovery_load_state");
  if (!raw) return null;

  let rec: RecoveryRecord;
  try {
    rec = JSON.parse(raw);
    if (!rec?.id || !rec.stage) throw new Error("missing id/stage");
  } catch (e) {
    appLogger.warn(CTX, `recovery state unreadable — discarding: ${e}`);
    await clearFiles().catch(() => {});
    return null;
  }

  const ageMin = (Date.now() - new Date(rec.updatedAt).getTime()) / 60000;
  const summary = `id=${rec.id} tx=${rec.transactionId} stage=${rec.stage} age=${ageMin.toFixed(1)}min resumes=${rec.resumeCount}`;
  appLogger.warn(CTX, `Found unfinished paid session — ${summary}`);

  const giveUp = async (event: string, reason: string, severity: "warning" | "error" | "critical") => {
    await journal(event, rec, { reason });
    logError("session_recovery_skipped", `${reason} — ${summary}`, undefined, severity);
    await clearFiles().catch(() => {});
  };

  if (!(ageMin <= SESSION_RECOVERY.MAX_AGE_MINUTES)) {
    await giveUp("expired", `older than ${SESSION_RECOVERY.MAX_AGE_MINUTES} min`, "warning");
    return null;
  }
  if (rec.resumeCount >= SESSION_RECOVERY.MAX_RESUMES) {
    await giveUp("too_many_resumes", `already resumed ${rec.resumeCount} times`, "critical");
    return null;
  }

  const fromStage = rec.stage;
  let target: ResumeTarget | null;
  try {
    target = await buildTarget(rec);
  } catch (e) {
    // เช็คสถานะการจ่ายเงินไม่ได้ — เก็บไว้ให้เปิดรอบหน้าเช็คใหม่
    await journal("check_failed", rec, { error: String(e) });
    return null;
  }

  if (!target) {
    await journal("nothing_to_resume", rec, { fromStage, printDone: rec.printDone ?? null });
    await clearFiles().catch(() => {});
    return null;
  }

  rec.resumeCount += 1;
  rec.history.push({ stage: rec.stage, at: now(), note: `resumed after restart (was ${fromStage}) → ${target.route}` });
  current = rec;
  await enqueue(() => persist(rec));
  await journal("resumed", rec, { fromStage, route: target.route });

  const msg = `Resumed paid session after restart — was at "${fromStage}", continuing at ${target.route} (${summary})`;
  appLogger.warn(CTX, msg);
  logError("session_resumed", msg, undefined, "warning");
  const txCode = transactionCodeOf(rec);
  if (txCode) {
    invoke("update_transaction_session_note", {
      transactionCode: txCode,
      sessionNote: `App restarted mid-session — resumed at ${target.route} (was ${fromStage})`,
      closeReason: "resumed",
    }).catch(() => {});
  }
  return target;
}
