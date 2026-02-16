import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ShutdownState {
  isScheduled: boolean;
  isPaused: boolean;
  remainingSeconds: number;
  totalSeconds: number;
  reason?: "manual" | "timer";
}

interface UseShutdownOptions {
  enabled?: boolean;
  onShutdownStarting?: () => void;
  onShutdownCancelled?: () => void;
}

/**
 * Hook to listen for shutdown countdown state from the Rust backend.
 * The actual shutdown logic (countdown timer, SSE event handling, OS shutdown)
 * runs entirely in Rust. This hook just receives state updates for the UI.
 */
export function useShutdown(options: UseShutdownOptions = {}) {
  const { enabled = true, onShutdownStarting, onShutdownCancelled } = options;
  const [state, setState] = useState<ShutdownState>({
    isScheduled: false,
    isPaused: false,
    remainingSeconds: 0,
    totalSeconds: 0,
  });

  useEffect(() => {
    if (!enabled) return;

    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      // Listen for countdown updates from Rust
      const u1 = await listen<ShutdownState>("shutdown-countdown", (event) => {
        setState(event.payload);
      });
      unlisteners.push(u1);

      // Listen for shutdown starting
      const u2 = await listen("shutdown-starting", () => {
        onShutdownStarting?.();
      });
      unlisteners.push(u2);

      // Listen for shutdown cancelled
      const u3 = await listen("shutdown-cancelled", () => {
        onShutdownCancelled?.();
        setState({
          isScheduled: false,
          isPaused: false,
          remainingSeconds: 0,
          totalSeconds: 0,
        });
      });
      unlisteners.push(u3);

      // Get initial state
      try {
        const s = await invoke<ShutdownState>("get_shutdown_state");
        setState(s);
      } catch {
        // ignore
      }
    };

    setup();

    return () => {
      for (const u of unlisteners) u();
    };
  }, [enabled, onShutdownStarting, onShutdownCancelled]);

  // Notify Rust backend of user activity (resets countdown)
  const notifyActivity = useCallback(() => {
    invoke("notify_user_activity").catch(() => {});
  }, []);

  // Cancel shutdown from frontend
  const cancelShutdown = useCallback(() => {
    invoke("cancel_shutdown").catch(() => {});
  }, []);

  // Start transaction (pause shutdown)
  const startTransaction = useCallback(() => {
    invoke("start_transaction").catch(() => {});
  }, []);

  // End transaction (resume shutdown)
  const endTransaction = useCallback(() => {
    invoke("end_transaction").catch(() => {});
  }, []);

  return {
    state,
    notifyActivity,
    cancelShutdown,
    startTransaction,
    endTransaction,
  };
}

export default useShutdown;
