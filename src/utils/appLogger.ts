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

    // ส่งไปยัง Tauri log plugin (เขียนลงไฟล์)
    const formatted = `[${context}] ${message}`;
    this.sendToTauri(level, formatted);
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
