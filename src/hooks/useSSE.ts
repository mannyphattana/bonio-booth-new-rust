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

  // Connect SSE via Rust backend
  const connect = useCallback(() => {
    if (!machineId || !enabled) return;
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
  }, []);

  useEffect(() => {
    if (!machineId || !enabled) return;

    // Listen for SSE events from Rust backend
    const setupListeners = async () => {
      // Listen for SSE events
      const unlistenEvent = await listen<SSEEvent>("sse-event", (event) => {
        const sseEvent = event.payload;
        console.log("[SSE] Event:", sseEvent);

        if (onEvent) onEvent(sseEvent);

        // Handle specific event types
        switch (sseEvent.type) {
          case "shutdown":
          case "shutdown-scheduled":
            if (onShutdown) {
              const data = sseEvent.data as Record<string, unknown>;
              const minutes = (data?.countdownMinutes as number) || 10;
              onShutdown(minutes);
            }
            break;
          case "shutdown-cancel":
          case "cancel-shutdown":
            if (onShutdownCancel) onShutdownCancel();
            break;
          case "maintenance":
            if (onMaintenanceMode) {
              const data = sseEvent.data as Record<string, unknown>;
              onMaintenanceMode(data?.enabled !== false);
            }
            break;
          case "maintenance-on":
            if (onMaintenanceMode) onMaintenanceMode(true);
            break;
          case "maintenance-off":
            if (onMaintenanceMode) onMaintenanceMode(false);
            break;
          case "config-updated":
            if (onConfigUpdated) {
              const data = sseEvent.data as Record<string, unknown>;
              onConfigUpdated(
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
          if (onConnectionChange) onConnectionChange(connected);
        }
      );

      unlistenersRef.current = [unlistenEvent, unlistenStatus];
    };

    setupListeners();
    connect();

    return () => {
      // Clean up listeners
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];
    };
  }, [machineId, enabled, connect, onEvent, onShutdown, onShutdownCancel, onMaintenanceMode, onConfigUpdated, onConnectionChange]);

  return { destroy };
}

export default useSSE;
