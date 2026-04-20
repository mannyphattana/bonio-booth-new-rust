/**
 * useTimerShutdown â€” Timer Auto-Shutdown Hook
 *
 * Periodically polls the backend (via init_machine) to check `isShutdownReady`.
 * When the machine is outside its operating period, starts a 2-minute shutdown countdown.
 * When the machine re-enters operating hours, cancels any timer-based shutdown.
 *
 * à¸­à¸´à¸‡ logic à¸ˆà¸²à¸ app booth: countdown à¸—à¸³à¸—à¸µà¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™
 * - à¹€à¸¡à¸·à¹ˆà¸­à¹„à¸›à¸«à¸™à¹‰à¸²à¸­à¸·à¹ˆà¸™ â†’ à¸¢à¸à¹€à¸¥à¸´à¸ countdown (cancel_timer_shutdown)
 * - à¹€à¸¡à¸·à¹ˆà¸­à¸­à¸¢à¸¹à¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸à¹à¸¥à¸° isShutdownReady â†’ ensure 2-min countdown
 *
 * Mirrors the old Electron system's behavior (home-page-active / home-page-inactive):
 * - Poll every 30s
 * - If isOnHomePage && isShutdownReady â†’ ensure 2-min countdown (idempotent)
 * - If !isOnHomePage â†’ cancel timer shutdown (countdown à¸¢à¸à¹€à¸¥à¸´à¸à¹€à¸¡à¸·à¹ˆà¸­à¸­à¸­à¸à¸ˆà¸²à¸à¸«à¸™à¹‰à¸²à¹à¸£à¸)
 * - User can tap the ShutdownOverlay to cancel and use the machine
 */

import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const COUNTDOWN_MINUTES = 2;

interface UseTimerShutdownOptions {
  /** Only enable when app is verified and has machine data */
  enabled: boolean;
  /** à¸­à¸¢à¸¹à¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™à¸–à¸¶à¸‡à¸ˆà¸°à¸£à¸±à¸™ countdown â€” à¸­à¸´à¸‡à¸ˆà¸²à¸ app booth (home-page-active / home-page-inactive) */
  isOnHomePage?: boolean;
  /** Callback when machine data is refreshed from poll */
  onMachineDataRefreshed?: (data: any) => void;
  /** Callback when backend unreachable (init_machine failed / network error) â€” à¹à¸ªà¸”à¸‡ maintenance à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸£à¸°à¸šà¸šà¹„à¸¡à¹ˆà¹„à¸”à¹‰ */
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
        appLogger.info(__CTX__, "[TimerShutdown] init_machine failed or no data:", result);
        onConnectionLost?.();
        return;
      }

      // Log response data for debugging
      appLogger.info(__CTX__, "[TimerShutdown] init_machine response:", {
        success: result.success,
        hasMachine: !!result.data.machine,
        isShutdownReady: result.data.isShutdownReady,
        isClosedAppReady: result.data.isClosedAppReady,
        isOnHomePage,
        machineId: result.data.machine?._id,
      });

      // Refresh machine/theme data if callback provided
      if (onMachineDataRefreshed && result.data.machine) {
        onMachineDataRefreshed(result.data);
      }

      const isShutdownReady = result.data.isShutdownReady || false;
      const isClosedAppReady = result.data.isClosedAppReady || false;
      const isAnyReady = isShutdownReady || isClosedAppReady;

      // à¸­à¸´à¸‡ app booth: countdown à¸—à¸³à¸—à¸µà¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸à¹€à¸—à¹ˆà¸²à¸™à¸±à¹‰à¸™ â€” à¹„à¸›à¸«à¸™à¹‰à¸²à¸­à¸·à¹ˆà¸™à¹ƒà¸«à¹‰à¸¢à¸à¹€à¸¥à¸´à¸
      if (!isOnHomePage) {
        if (lastShutdownReadyRef.current) {
          appLogger.info(__CTX__, 
            "[TimerShutdown] Left home page, cancelling timer shutdown",
          );
          await invoke("cancel_timer_shutdown");
          lastShutdownReadyRef.current = false;
        }
        return;
      }

      // à¸­à¸¢à¸¹à¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸ â€” à¹ƒà¸Šà¹‰ logic à¹€à¸”à¸´à¸¡
      const shutdownType = isClosedAppReady ? "close-app" : isShutdownReady ? "shutdown" : null;

      if (isAnyReady && !lastShutdownReadyRef.current) {
        // Transition: operating hours â†’ outside operating hours
        appLogger.info(__CTX__, 
          `[TimerShutdown] Outside operating hours (on home), starting countdown (type: ${shutdownType})`,
        );
        await invoke("ensure_shutdown_countdown", {
          minutes: COUNTDOWN_MINUTES,
          reason: "timer",
          shutdownType: shutdownType,
        });
      } else if (isAnyReady && lastShutdownReadyRef.current) {
        // Still outside operating hours â€” ensure countdown (idempotent)
        await invoke("ensure_shutdown_countdown", {
          minutes: COUNTDOWN_MINUTES,
          reason: "timer",
          shutdownType: shutdownType,
        });
      } else if (!isAnyReady && lastShutdownReadyRef.current) {
        // Transition: outside operating hours â†’ back in operating hours
        appLogger.info(__CTX__, 
          "[TimerShutdown] Back in operating hours, cancelling timer shutdown",
        );
        await invoke("cancel_timer_shutdown");
      }

      lastShutdownReadyRef.current = isAnyReady;
    } catch (err) {
      appLogger.error(__CTX__, "[TimerShutdown] Check failed:", err);
      onConnectionLost?.();
    }
  }, [onMachineDataRefreshed, onConnectionLost, isOnHomePage]);

  // à¹€à¸¡à¸·à¹ˆà¸­à¸­à¸­à¸à¸ˆà¸²à¸à¸«à¸™à¹‰à¸²à¹à¸£à¸ â†’ à¸¢à¸à¹€à¸¥à¸´à¸ timer shutdown à¸—à¸±à¸™à¸—à¸µ
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

    // Check immediately on mount (à¹€à¸¡à¸·à¹ˆà¸­à¸­à¸¢à¸¹à¹ˆà¸«à¸™à¹‰à¸²à¹à¸£à¸)
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

