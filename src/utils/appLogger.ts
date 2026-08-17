import { invoke } from "@tauri-apps/api/core";

export const appLogger = {
  info: (category: string, message: string): void => {
    console.log(`[INFO] ${category} ${message}`);
  },
  warn: (category: string, message: string): void => {
    console.warn(`[WARN] ${category} ${message}`);
  },
  error: (category: string, message: string): void => {
    console.error(`[ERROR] ${category} ${message}`);
    invoke("send_error_log", {
      errorType: category,
      errorMessage: message,
      errorStack: null,
      severity: "error",
    }).catch(() => {});
  },
};
