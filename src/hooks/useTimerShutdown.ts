/**
 * useTimerShutdown — Timer Auto-Shutdown Hook
 *
 * Periodically polls the backend (via init_machine) to check `isShutdownReady`.
 * When the machine is outside its operating period, starts a 2-minute shutdown countdown.
 * When the machine re-enters operating hours, cancels any timer-based shutdown.
 *
 * อิง logic จาก app booth: countdown ทำที่หน้าแรกเท่านั้น
 * - เมื่อไปหน้าอื่น → ยกเลิก countdown (cancel_timer_shutdown)
 * - เมื่ออยู่หน้าแรกและ isShutdownReady → ensure 2-min countdown
 *
 * Mirrors the old Electron system's behavior (home-page-active / home-page-inactive):
 * - Poll every 30s
 * - If isOnHomePage && isShutdownReady → ensure 2-min countdown (idempotent)
 * - If !isOnHomePage → cancel timer shutdown (countdown ยกเลิกเมื่อออกจากหน้าแรก)
 * - User can tap the ShutdownOverlay to cancel and use the machine
 */

import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appLogger } from "../utils/appLogger";

const CTX = "[useTimerShutdown]";
const POLL_INTERVAL_MS = 30_000; // 30 seconds
const COUNTDOWN_MINUTES = 2;

interface UseTimerShutdownOptions {
  /** Only enable when app is verified and has machine data */
  enabled: boolean;
  /** อยู่หน้าแรกเท่านั้นถึงจะรัน countdown — อิงจาก app booth (home-page-active / home-page-inactive) */
  isOnHomePage?: boolean;
  /** Callback when machine data is refreshed from poll */
  onMachineDataRefreshed?: (data: any) => void;
  /** Callback when backend unreachable (init_machine failed / network error) — แสดง maintenance เชื่อมต่อระบบไม่ได้ */
  onConnectionLost?: () => void;
}

export function useTimerShutdown({
  enabled,
  isOnHomePage = true,
  onMachineDataRefreshed,
  onConnectionLost,
}: UseTimerShutdownOptions) {
  const lastShutdownReadyRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkTimerShutdown = useCallback(async () => {
    try {
      const result: any = await invoke("init_machine");

      if (!result?.success || !result?.data) {
        appLogger.warn(CTX, "[TimerShutdown] init_machine failed or no data");
        onConnectionLost?.();
        return;
      }

      // Refresh machine/theme data if callback provided
      if (onMachineDataRefreshed && result.data.machine) {
        onMachineDataRefreshed(result.data);
      }

      const isShutdownReady = result.data.isShutdownReady || false;
      const isClosedAppReady = result.data.isClosedAppReady || false;
      const isAnyReady = isShutdownReady || isClosedAppReady;

      // อิง app booth: countdown ทำที่หน้าแรกเท่านั้น — ไปหน้าอื่นให้ยกเลิก
      if (!isOnHomePage) {
        if (lastShutdownReadyRef.current) {
          appLogger.info(CTX, 
            "[TimerShutdown] Left home page, cancelling timer shutdown",
          );
          await invoke("cancel_timer_shutdown");
          lastShutdownReadyRef.current = false;
        }
        return;
      }

      // อยู่หน้าแรก — ใช้ logic เดิม
      const shutdownType = isClosedAppReady ? "close-app" : isShutdownReady ? "shutdown" : null;

      if (isAnyReady && !lastShutdownReadyRef.current) {
        // Transition: operating hours → outside operating hours
        appLogger.info(CTX, 
          `[TimerShutdown] Outside operating hours (on home), starting countdown (type: ${shutdownType})`,
        );
        await invoke("ensure_shutdown_countdown", {
          minutes: COUNTDOWN_MINUTES,
          reason: "timer",
          shutdownType: shutdownType,
        });
      } else if (isAnyReady && lastShutdownReadyRef.current) {
        // Still outside operating hours — ensure countdown (idempotent)
        await invoke("ensure_shutdown_countdown", {
          minutes: COUNTDOWN_MINUTES,
          reason: "timer",
          shutdownType: shutdownType,
        });
      } else if (!isAnyReady && lastShutdownReadyRef.current) {
        // Transition: outside operating hours → back in operating hours
        appLogger.info(CTX, 
          "[TimerShutdown] Back in operating hours, cancelling timer shutdown",
        );
        await invoke("cancel_timer_shutdown");
      }

      lastShutdownReadyRef.current = isAnyReady;
    } catch (err) {
      appLogger.error(CTX, "[TimerShutdown] Check failed:", err);
      onConnectionLost?.();
    }
  }, [onMachineDataRefreshed, onConnectionLost, isOnHomePage]);

  // เมื่อออกจากหน้าแรก → ยกเลิก timer shutdown ทันที
  useEffect(() => {
    if (enabled && !isOnHomePage) {
      invoke("cancel_timer_shutdown").catch(() => {});
      lastShutdownReadyRef.current = false;
    }
  }, [enabled, isOnHomePage]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      lastShutdownReadyRef.current = false;
      return;
    }

    // Check immediately on mount (เมื่ออยู่หน้าแรก)
    if (isOnHomePage) {
      checkTimerShutdown();
    }

    // Then poll periodically
    intervalRef.current = setInterval(checkTimerShutdown, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, isOnHomePage, checkTimerShutdown]);
}

