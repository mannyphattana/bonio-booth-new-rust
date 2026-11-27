/**
 * Pending Upload Store
 *
 * เก็บ metadata ของ upload session ที่ยังไม่สมบูรณ์ไว้ใน localStorage
 * เพื่อให้ retryUploadManager สามารถนำไป retry ได้ในภายหลัง
 */

const STORAGE_KEY = "bonio_pending_uploads";

/**
 * ลองครบกี่รอบแล้วยอม confirm เท่าที่ขึ้นได้ (ถ้ารูปเฟรมขึ้นแล้ว) ลูกค้าจะได้มีอะไรให้โหลดก่อน
 * — record ไม่ถูกทิ้งเพราะจำนวนครั้งแล้ว: ลองต่อไปเรื่อยๆ จนสำเร็จ ไฟล์หาย หรือเก่าเกิน RECORD_EXPIRY_DAYS
 * (เดิมลอง 3 รอบแล้วทิ้ง: เน็ตหลุดครึ่งชั่วโมงไฟล์ลูกค้าก็ไม่ขึ้นอีกเลย)
 */
export const MAX_RETRY_COUNT = 3;

/** เก่ากว่านี้เลิกลอง (ไฟล์ยังอยู่ใน C:\boniobooth\Saved_Photos ให้ dashboard สั่ง re-upload ได้) */
export const RECORD_EXPIRY_DAYS = 7;

/** หลังลองครบ MAX_RETRY_COUNT รอบ เว้นระยะห่างขึ้นเรื่อยๆ: 30 นาที, 1, 2, 4 ชั่วโมง, แล้วทุก 6 ชั่วโมง */
const BACKOFF_START_MS = 30 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

/** ถึงเวลาลองรอบหน้าของ record นี้หรือยัง */
export function isDue(record: PendingUploadRecord, now: number = Date.now()): boolean {
  if (record.retryCount < MAX_RETRY_COUNT || !record.lastAttempt) return true;
  const wait = Math.min(BACKOFF_START_MS * 2 ** (record.retryCount - MAX_RETRY_COUNT), BACKOFF_MAX_MS);
  return now - new Date(record.lastAttempt).getTime() >= wait;
}

export interface PendingUploadFile {
  /** "frame" = รูปที่รวมกรอบแล้ว, "photo" = รูปเดี่ยว, "video" = วิดีโอ */
  type: "frame" | "photo" | "video";
  /** absolute path บน disk เช่น C:\boniobooth\Saved_Photos\BonioBooth_xxx_Frame.jpg */
  localPath: string;
  /** ลำดับ (สำหรับ map กับ presign uploadUrls) */
  order: number;
  /** MIME type: "image/jpeg" | "video/mp4" */
  contentType: string;
}

export interface PendingUploadRecord {
  /** txId ใช้เป็น unique key — เช่น timestamp หรือ referenceId */
  txId: string;
  /** MongoDB ObjectId ของ transaction สำหรับส่งไปยัง presign API */
  transactionId: string;
  /** "TXN-xxx" ถ้ามี */
  transactionCode?: string;
  /** ISO timestamp ตอนสร้าง record */
  createdAt: string;
  /** รายการไฟล์ที่ต้องอัพโหลด */
  files: PendingUploadFile[];
  /** จำนวนครั้งที่ retry แล้ว (เริ่มต้นที่ 0) */
  retryCount: number;
  /** ISO timestamp ของครั้งล่าสุดที่ลอง retry */
  lastAttempt?: string;
}

// ============================================================
// Internal helpers
// ============================================================

function loadAll(): PendingUploadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PendingUploadRecord[];
  } catch {
    return [];
  }
}

function saveAll(records: PendingUploadRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage full หรือ error อื่น — ไม่ crash app
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * บันทึก pending upload record ใหม่
 * ถ้า txId ซ้ำกัน จะ overwrite record เดิม
 */
export function addPendingUpload(record: PendingUploadRecord): void {
  const records = loadAll();
  const idx = records.findIndex((r) => r.txId === record.txId);
  if (idx >= 0) {
    records[idx] = record;
  } else {
    records.push(record);
  }
  saveAll(records);
}

/**
 * ลบ pending upload record เมื่ออัพโหลดสำเร็จ
 */
export function removePendingUpload(txId: string): void {
  const records = loadAll().filter((r) => r.txId !== txId);
  saveAll(records);
}

/**
 * ดึง records ทั้งหมด
 */
export function getAllPending(): PendingUploadRecord[] {
  return loadAll();
}

/**
 * เพิ่ม retryCount และบันทึก lastAttempt
 */
export function incrementRetryCount(txId: string): void {
  const records = loadAll();
  const idx = records.findIndex((r) => r.txId === txId);
  if (idx >= 0) {
    records[idx].retryCount += 1;
    records[idx].lastAttempt = new Date().toISOString();
    saveAll(records);
  }
}

/**
 * ลบ records ที่เก่าเกิน maxAgeDays เรียกก่อนเริ่ม retry cycle เพื่อทำความสะอาด
 */
export function cleanExpired(maxAgeDays: number = RECORD_EXPIRY_DAYS): void {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const all = loadAll();
  const records = all.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
  if (records.length !== all.length) saveAll(records);
}

/**
 * records ที่ยังต้องอัปโหลด ใหม่สุดก่อน (ลูกค้าที่เพิ่งถ่ายรอดูอยู่)
 */
export function getRetryablePending(): PendingUploadRecord[] {
  cleanExpired();
  return getAllPending().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// ============================================================
// In-flight guard (in-memory)
//
// เก็บ txId ของ session ที่กำลังอัพโหลดสดอยู่ (ในหน้า PhotoResult)
// เพื่อให้ retry manager ข้ามไป ป้องกันการอัพซ้ำจากการชนกันของ
// upload ปกติ กับ retry cycle (startup +30s / ทุก 10 นาที)
// เป็น in-memory ล้วน — เคลียร์เองเมื่อรีสตาร์ทแอป ซึ่งถูกต้อง
// เพราะหลังรีสตาร์ทย่อมไม่มี upload สดค้างอยู่
// ============================================================

const _activeUploadTxIds = new Set<string>();

/** ทำเครื่องหมายว่า txId นี้กำลังอัพโหลดสดอยู่ (retry ต้องข้าม) */
export function markUploadActive(txId: string): void {
  if (txId) _activeUploadTxIds.add(txId);
}

/** ยกเลิกเครื่องหมาย in-flight เมื่ออัพโหลดจบ (สำเร็จหรือล้มเหลวก็ตาม) */
export function markUploadInactive(txId: string): void {
  if (txId) _activeUploadTxIds.delete(txId);
}

/** ตรวจว่า txId กำลังอัพโหลดสดอยู่หรือไม่ */
export function isUploadActive(txId: string): boolean {
  return _activeUploadTxIds.has(txId);
}
