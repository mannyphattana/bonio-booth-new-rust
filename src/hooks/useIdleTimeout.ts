import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "../utils/appLogger";
import { logError } from "../utils/logger";

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface IdleTimeoutOptions {
  /** transaction code ที่กำลังดำเนินอยู่ — ถ้ามีจะบันทึก sessionNote เมื่อ idle ทำงาน */
  transactionCode?: string;
  /** route ที่จะ redirect ไปเมื่อ idle (default: "/") */
  redirectTo?: string;
}

/**
 * Auto-navigate to home ("/") after 5 minutes of user inactivity.
 * Resets timer on mouse/touch/keyboard events.
 * If transactionCode is provided, records idle timeout as sessionNote on the transaction.
 */
export function useIdleTimeout(options: IdleTimeoutOptions | string = "/") {
  // รองรับ legacy call signature: useIdleTimeout() หรือ useIdleTimeout("/")
  const redirectTo = typeof options === "string" ? options : (options.redirectTo ?? "/");
  const transactionCode = typeof options === "string" ? undefined : options.transactionCode;

  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const msg = `Idle timeout fired — user inactive for 5 minutes${transactionCode ? `, txCode: ${transactionCode}` : ""}`;
      appLogger.warn("[IdleTimeout]", msg);

      // ส่ง error log ไป backend ทันที (ไม่ต้องรอปิด app)
      logError("idle_timeout", msg, undefined, "info");

      // บันทึก sessionNote ลง transaction ถ้ามี transactionCode
      if (transactionCode) {
        try {
          await invoke("update_transaction_session_note", {
            transactionCode,
            sessionNote: "Idle timeout — no user interaction for 5 minutes",
            closeReason: "timeout",
          });
          appLogger.info("[IdleTimeout]", `sessionNote updated for txCode: ${transactionCode}`);
        } catch (err) {
          appLogger.error("[IdleTimeout]", `update_transaction_session_note failed: ${err}`);
        }
      }

      navigate(redirectTo);
    }, IDLE_TIMEOUT_MS);
  }, [navigate, redirectTo, transactionCode]);

  useEffect(() => {
    const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, resetTimer));
    resetTimer(); // start timer immediately

    return () => {
      events.forEach((e) => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [resetTimer]);
}
