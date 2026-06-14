import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
}

// ============================================================
// AppLogger — Centralized structured logger สำหรับ Bonio Booth
//
// หน้าที่:
//  1. เก็บ log entries ใน memory buffer (สำหรับส่งเป็น session log)
//  2. ส่ง log ไปยัง Tauri log plugin (เขียนลงไฟล์บน disk + webview console)
//  3. ไม่มี console.log โดยตรงในโค้ดอื่น — ใช้ logger นี้แทน
// ============================================================

const MAX_BUFFER_SIZE = 2000; // จำกัดจำนวน entries ใน memory

// Crash-survivable mirror: เก็บ log ล่าสุดไว้ใน localStorage ทุกครั้งที่ log
// เพื่อให้บรรทัดก่อน crash รอดมาถึง startup ครั้งถัดไป (buffer ใน RAM หายไปกับ process)
const RECENT_KEY = "bonio_recent_logs";
const RECENT_MAX = 100; // จำนวนบรรทัดล่าสุดที่ persist (เล็กพอให้ setItem ถูก/เร็ว)

/** อ่าน log ล่าสุดที่ persist ไว้จาก session ก่อนหน้า (ใช้ตอน crash recovery) */
export function readPersistedLogs(): LogEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** ล้าง log ที่ persist ไว้ (เรียกหลังอ่านมาใช้แล้วตอน startup) */
export function clearPersistedLogs(): void {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // ignore
  }
}

class AppLogger {
  private buffer: LogEntry[] = [];

  private push(level: LogLevel, context: string, message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
    };
    this.buffer.push(entry);

    // ตัด buffer ถ้าใหญ่เกิน
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_SIZE);
    }

    // mirror บรรทัดล่าสุดลง localStorage (best-effort) เพื่อ crash recovery
    this.persistRecent();

    // ส่งไปยัง Tauri log plugin (เขียนลงไฟล์)
    const formatted = `[${context}] ${message}`;
    this.sendToTauri(level, formatted);
  }

  /** เขียน log ล่าสุด RECENT_MAX บรรทัดลง localStorage — เขียนทุกครั้งแบบ synchronous
   *  เพื่อรับประกันว่าบรรทัดสุดท้ายก่อน crash ถูกบันทึก */
  private persistRecent(): void {
    try {
      const recent = this.buffer.slice(-RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // localStorage quota เต็ม/ใช้ไม่ได้ — ข้ามไป best-effort
    }
  }

  private sendToTauri(level: LogLevel, message: string): void {
    // ใช้ Tauri log commands (tauri-plugin-log)
    // fire-and-forget — ไม่ await
    switch (level) {
      case "debug":
        invoke("plugin:log|log", { level: 5, message }).catch(() => {});
        break;
      case "info":
        invoke("plugin:log|log", { level: 4, message }).catch(() => {});
        break;
      case "warn":
        invoke("plugin:log|log", { level: 3, message }).catch(() => {});
        break;
      case "error":
        invoke("plugin:log|log", { level: 2, message }).catch(() => {});
        break;
    }
  }

  info(context: string, message: string, ...extra: unknown[]): void {
    this.push("info", context, this.fmt(message, extra));
  }

  warn(context: string, message: string, ...extra: unknown[]): void {
    this.push("warn", context, this.fmt(message, extra));
  }

  error(context: string, message: string, ...extra: unknown[]): void {
    this.push("error", context, this.fmt(message, extra));
  }

  debug(context: string, message: string, ...extra: unknown[]): void {
    this.push("debug", context, this.fmt(message, extra));
  }

  private fmt(message: string, extra: unknown[]): string {
    if (extra.length === 0) return message;
    return `${message} ${extra.map((e) => (typeof e === "object" ? JSON.stringify(e) : String(e))).join(" ")}`;
  }

  /** คืน log entries ทั้งหมด (สำหรับส่งเป็น session log ตอน exit) */
  getEntries(): LogEntry[] {
    return [...this.buffer];
  }

  /** ล้าง buffer */
  clear(): void {
    this.buffer = [];
  }

  /** สร้าง summary สั้นๆ จาก buffer */
  buildSummary(): string {
    const errors = this.buffer.filter((e) => e.level === "error").length;
    const warns = this.buffer.filter((e) => e.level === "warn").length;
    const total = this.buffer.length;
    if (errors > 0 || warns > 0) {
      return `${total} log entries — ${errors} error(s), ${warns} warning(s)`;
    }
    return `${total} log entries — no errors`;
  }
}

// Singleton instance
export const appLogger = new AppLogger();
