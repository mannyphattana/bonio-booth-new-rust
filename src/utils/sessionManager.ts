/**
 * Session Manager — จัดการ lifecycle ของ app session
 *
 * หน้าที่:
 * 1. สร้าง sessionId และบันทึก startedAt เมื่อ app เปิด
 * 2. เก็บ sessionId ใน localStorage เพื่อ crash recovery (ถ้า app crash จะไม่ถูกลบ)
 * 3. ส่ง session log ไปยัง backend ก่อน exit (clean exit หรือ timer/auto-update)
 * 4. ตอน startup ตรวจสอบว่ามี session ค้างอยู่หรือเปล่า → ถ้าใช่ = crash session ก่อนหน้า
 *
 * ใช้เป็น singleton module — ไม่ใช่ React state เพื่อให้ใช้ได้จาก anywhere
 */

import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "./appLogger";

const STORAGE_KEY = "bonio_current_session";
const APP_VERSION = "__APP_VERSION__"; // replaced by Vite at build time (or use import.meta.env)

interface SessionRecord {
  sessionId: string;
  startedAt: string;
}

let _sessionId = "";
let _startedAt = "";
let _sessionSent = false;

function getVersion(): string {
  try {
    // Vite exposes this via import.meta.env.VITE_APP_VERSION or __APP_VERSION__
    return (import.meta as any).env?.VITE_APP_VERSION ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * เรียกตอน App mount — ตรวจสอบ crash recovery และเริ่ม session ใหม่
 */
export async function initSession(): Promise<void> {
  // --- Crash recovery: ถ้ามี session ค้างอยู่ใน localStorage แสดงว่า app crash ครั้งก่อน
  const prevRaw = localStorage.getItem(STORAGE_KEY);
  if (prevRaw) {
    try {
      const prev: SessionRecord = JSON.parse(prevRaw);
      appLogger.warn("[SessionManager]", `Crash recovery: previous session ${prev.sessionId} was not closed cleanly`);
      await invoke("send_app_session_log", {
        sessionId: prev.sessionId,
        startedAt: prev.startedAt,
        endedAt: new Date().toISOString(),
        durationSeconds: calcDuration(prev.startedAt),
        closeReason: "crash",
        appVersion: getVersion(),
        entries: [], // ไม่มี entries สำหรับ crash session
        summary: "App closed unexpectedly (crash or force-quit detected on next startup)",
      }).catch((e) => {
        appLogger.error("[SessionManager]", `Failed to send crash recovery log: ${e}`);
      });
    } catch {
      // JSON parse error — ล้างทิ้ง
    }
    localStorage.removeItem(STORAGE_KEY);
  }

  // --- เริ่ม session ใหม่
  _sessionId = generateUUID();
  _startedAt = new Date().toISOString();
  _sessionSent = false;

  // บันทึกใน localStorage (สำหรับ crash recovery ในครั้งถัดไป)
  const record: SessionRecord = { sessionId: _sessionId, startedAt: _startedAt };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));

  appLogger.info("[SessionManager]", `Session started: ${_sessionId}`);

  // แจ้ง Rust ให้รู้ session ปัจจุบัน
  await invoke("init_app_session", {
    sessionId: _sessionId,
    startedAt: _startedAt,
  }).catch((e) => {
    appLogger.warn("[SessionManager]", `init_app_session failed: ${e}`);
  });
}

/**
 * ส่ง session log ก่อน exit — เรียกก่อนทุก clean exit
 * idempotent: ถ้าเรียกซ้ำจะ skip
 */
export async function sendSessionLog(
  closeReason: "user_exit" | "timer" | "auto_update" | "crash" | "unknown"
): Promise<void> {
  if (_sessionSent || !_sessionId) return;
  _sessionSent = true;

  const endedAt = new Date().toISOString();
  const durationSeconds = calcDuration(_startedAt);
  const entries = appLogger.getEntries();
  const summary = appLogger.buildSummary();

  appLogger.info(
    "[SessionManager]",
    `Sending session log: ${closeReason}, ${entries.length} entries, ${durationSeconds}s`
  );

  // ลบ localStorage marker (clean exit — ไม่ต้อง crash recovery)
  localStorage.removeItem(STORAGE_KEY);

  try {
    await invoke("send_app_session_log", {
      sessionId: _sessionId,
      startedAt: _startedAt,
      endedAt,
      durationSeconds,
      closeReason,
      appVersion: getVersion(),
      entries,
      summary,
    });
    appLogger.info("[SessionManager]", `Session log sent successfully`);
  } catch (e) {
    appLogger.error("[SessionManager]", `Failed to send session log: ${e}`);
  }
}

export function getSessionId(): string {
  return _sessionId;
}

function calcDuration(startedAt: string): number {
  try {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    return Math.round((now - start) / 1000);
  } catch {
    return 0;
  }
}

function generateUUID(): string {
  // ใช้ crypto.randomUUID ถ้ามี
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
