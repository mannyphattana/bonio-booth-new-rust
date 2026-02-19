/**
 * useTimerShutdown — Timer Auto-Shutdown Hook
 *
 * Periodically polls the backend (via init_machine) to check `isShutdownReady`.
 * When the machine is outside its operating period, starts a 2-minute shutdown countdown.
 * When the machine re-enters operating hours, cancels any timer-based shutdown.
 *
 * Mirrors the old Electron system's behavior:
 * - Poll every 30s
 * - If isShutdownReady → ensure 2-min countdown (idempotent, won't reset if already running)
 * - If isShutdownReady becomes false → cancel timer shutdown (but not manual shutdowns)
 * - User can tap the ShutdownOverlay to cancel and use the machine
 */

import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const COUNTDOWN_MINUTES = 2;

interface UseTimerShutdownOptions {
  /** Only enable when app is verified and has machine data */
  enabled: boolean;
  /** Callback when machine data is refreshed from poll */
  onMachineDataRefreshed?: (data: any) => void;
}

export function useTimerShutdown({
  enabled,
  onMachineDataRefreshed,
}: UseTimerShutdownOptions) {
  const lastShutdownReadyRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkTimerShutdown = useCallback(async () => {
    try {
      const result: any = await invoke("init_machine");

      if (!result?.success || !result?.data) {
        console.log("[TimerShutdown] init_machine failed or no data:", result);
        return;
      }

      // Log response data for debugging
      console.log("[TimerShutdown] init_machine response:", {
        success: result.success,
        hasMachine: !!result.data.machine,
        isShutdownReady: result.data.isShutdownReady,
        isClosedAppReady: result.data.isClosedAppReady,
        machineId: result.data.machine?._id,
        fullData: result.data,
      });

      // Refresh machine/theme data if callback provided
      if (onMachineDataRefreshed && result.data.machine) {
        onMachineDataRefreshed(result.data);
      }

      const isShutdownReady = result.data.isShutdownReady || false;
      const isClosedAppReady = result.data.isClosedAppReady || false;
      const isAnyReady = isShutdownReady || isClosedAppReady;

      // Determine shutdown type
      const shutdownType = isClosedAppReady ? "close-app" : isShutdownReady ? "shutdown" : null;

      if (isAnyReady && !lastShutdownReadyRef.current) {
        // Transition: operating hours → outside operating hours
        console.log(
          `[TimerShutdown] Outside operating hours, starting countdown (type: ${shutdownType})`,
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
        console.log(
          "[TimerShutdown] Back in operating hours, cancelling timer shutdown",
        );
        await invoke("cancel_timer_shutdown");
      }

      lastShutdownReadyRef.current = isAnyReady;
    } catch (err) {
      console.error("[TimerShutdown] Check failed:", err);
    }
  }, [onMachineDataRefreshed]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      lastShutdownReadyRef.current = false;
      return;
    }

    // Check immediately on mount
    checkTimerShutdown();

    // Then poll periodically
    intervalRef.current = setInterval(checkTimerShutdown, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, checkTimerShutdown]);
}
