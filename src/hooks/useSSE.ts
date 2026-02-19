import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SSEEvent {
  type: string;
  data: any;
}

interface UseSSEOptions {
  machineId: string;
  enabled?: boolean;
  onEvent?: (event: SSEEvent) => void;
  onShutdown?: (countdownMinutes: number) => void;
  onShutdownCancel?: () => void;
  onMaintenanceMode?: (enabled: boolean) => void;
  onConfigUpdated?: (configType: string, data?: any) => void;
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * SSE hook that connects via the Rust backend.
 *
 * The Rust backend maintains a persistent HTTP connection to the SSE endpoint.
 * When the app closes (or crashes), the TCP connection drops and the server
 * automatically detects the disconnect → sends Telegram notification.
 *
 * Events from the server are forwarded to the frontend via Tauri events.
 */
export function useSSE(options: UseSSEOptions) {
  const {
    machineId,
    enabled = true,
    onEvent,
    onShutdown,
    onShutdownCancel,
    onMaintenanceMode,
    onConfigUpdated,
    onConnectionChange,
  } = options;

  const connectedRef = useRef(false);
  const unlistenersRef = useRef<UnlistenFn[]>([]);
  const currentMachineIdRef = useRef<string>("");
  const listenersSetupRef = useRef(false);

  // Store callbacks in refs to avoid re-creating listeners when callbacks change
  const callbacksRef = useRef({
    onEvent,
    onShutdown,
    onShutdownCancel,
    onMaintenanceMode,
    onConfigUpdated,
    onConnectionChange,
  });

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = {
      onEvent,
      onShutdown,
      onShutdownCancel,
      onMaintenanceMode,
      onConfigUpdated,
      onConnectionChange,
    };
  }, [onEvent, onShutdown, onShutdownCancel, onMaintenanceMode, onConfigUpdated, onConnectionChange]);

  // Connect SSE via Rust backend
  const connect = useCallback(() => {
    if (!machineId || !enabled) return;
    // Only connect if machineId actually changed
    if (currentMachineIdRef.current === machineId && listenersSetupRef.current) {
      console.log("[SSE] MachineId unchanged, skipping reconnect");
      return;
    }
    console.log("[SSE] Requesting Rust backend to connect...");
    invoke("connect_sse").catch((err: unknown) => {
      console.error("[SSE] Failed to connect:", err);
    });
  }, [machineId, enabled]);

  // Destroy SSE (disconnect + cleanup, idempotent)
  const destroy = useCallback(() => {
    console.log("[SSE] Requesting Rust backend to destroy...");
    invoke("destroy_sse").catch((err: unknown) => {
      console.error("[SSE] Failed to destroy:", err);
    });
    listenersSetupRef.current = false;
    currentMachineIdRef.current = "";
  }, []);

  useEffect(() => {
    if (!machineId || !enabled) {
      // Clean up if disabled
      if (listenersSetupRef.current) {
        for (const unlisten of unlistenersRef.current) {
          unlisten();
        }
        unlistenersRef.current = [];
        listenersSetupRef.current = false;
      }
      return;
    }

    // Only setup listeners once, reuse them if machineId is the same
    if (!listenersSetupRef.current || currentMachineIdRef.current !== machineId) {
      // Clean up old listeners if machineId changed
      if (listenersSetupRef.current) {
        for (const unlisten of unlistenersRef.current) {
          unlisten();
        }
        unlistenersRef.current = [];
      }

      // Listen for SSE events from Rust backend
      const setupListeners = async () => {
        // Listen for SSE events
        const unlistenEvent = await listen<SSEEvent>("sse-event", (event) => {
          const sseEvent = event.payload;
          console.log("[SSE] Event:", sseEvent);

          const callbacks = callbacksRef.current;
          if (callbacks.onEvent) callbacks.onEvent(sseEvent);

          // Handle specific event types
          switch (sseEvent.type) {
            case "shutdown":
            case "shutdown-scheduled":
              if (callbacks.onShutdown) {
                const data = sseEvent.data as Record<string, unknown>;
                const minutes = (data?.countdownMinutes as number) || 10;
                callbacks.onShutdown(minutes);
              }
              break;
            case "shutdown-cancel":
            case "cancel-shutdown":
              if (callbacks.onShutdownCancel) callbacks.onShutdownCancel();
              break;
            case "maintenance":
              if (callbacks.onMaintenanceMode) {
                const data = sseEvent.data as Record<string, unknown>;
                callbacks.onMaintenanceMode(data?.enabled !== false);
              }
              break;
            case "maintenance-on":
              if (callbacks.onMaintenanceMode) callbacks.onMaintenanceMode(true);
              break;
            case "maintenance-off":
              if (callbacks.onMaintenanceMode) callbacks.onMaintenanceMode(false);
              break;
            case "config-updated":
              if (callbacks.onConfigUpdated) {
                const data = sseEvent.data as Record<string, unknown>;
                callbacks.onConfigUpdated(
                  (data?.configType as string) || "unknown",
                  data?.data,
                );
              }
              break;
            // close-app is handled directly in Rust backend (calls app.exit)
          }
        });

        // Listen for SSE connection status
        const unlistenStatus = await listen<{ connected: boolean; status502?: boolean }>(
          "sse-status",
          (event) => {
            const { connected } = event.payload;
            connectedRef.current = connected;
            console.log(`[SSE] Connection status: ${connected ? "connected" : "disconnected"}`);
            const callbacks = callbacksRef.current;
            if (callbacks.onConnectionChange) callbacks.onConnectionChange(connected);
          }
        );

        unlistenersRef.current = [unlistenEvent, unlistenStatus];
        listenersSetupRef.current = true;
        currentMachineIdRef.current = machineId;
      };

      setupListeners();
    }

    // Only connect if machineId changed
    if (currentMachineIdRef.current !== machineId) {
      connect();
    }

    return () => {
      // Only clean up listeners on unmount or when machineId/enabled changes significantly
      // Don't clean up on every re-render
    };
  }, [machineId, enabled, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];
      listenersSetupRef.current = false;
    };
  }, []);

  return { destroy };
}

export default useSSE;
