import { invoke } from "@tauri-apps/api/core";

export type LogSeverity = "info" | "warning" | "error" | "critical";

/**
 * ส่ง error log ไปยัง backend (fire-and-forget)
 * ไม่ throw ในทุกกรณี — ไม่ทำให้แอพ crash ถ้าส่งไม่ได้
 */
export function logError(
  errorType: string,
  message: string,
  stack?: string,
  severity: LogSeverity = "error"
): void {
  invoke("send_error_log", {
    errorType,
    errorMessage: message,
    errorStack: stack ?? null,
    severity,
  }).catch(() => {
    // ไม่ต้องทำอะไร — Rust command จะ log warning เอง
  });
}
