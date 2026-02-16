import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface CanonState {
  initialized: boolean;
  connected: boolean;
  liveViewActive: boolean;
  liveViewFrame: string; // base64 data URL
  error: string;
}

/**
 * Hook to manage Canon DSLR camera lifecycle via Tauri commands.
 *
 * Lifecycle: initialize → connect → openSession → startLiveView → poll frames
 * Capture:   takePicture (stops LV internally, returns base64, restarts LV)
 * Cleanup:   stopLiveView → closeSession → terminate
 */
export function useCanon() {
  const [state, setState] = useState<CanonState>({
    initialized: false,
    connected: false,
    liveViewActive: false,
    liveViewFrame: "",
    error: "",
  });

  const liveViewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestFrameRef = useRef<string>("");
  const isCleanedUpRef = useRef(false);

  // Frame recording for video/boomerang
  const isRecordingRef = useRef(false);
  const recordedFramesRef = useRef<string[]>([]);
  const recordedTimestampsRef = useRef<number[]>([]);

  // Initialize Canon SDK
  const initialize = useCallback(async (): Promise<boolean> => {
    try {
      const result = await invoke<{ success: boolean; error?: string }>("canon_initialize");
      if (result.success) {
        setState((s) => ({ ...s, initialized: true, error: "" }));
        return true;
      }
      setState((s) => ({ ...s, error: result.error || "SDK init failed" }));
      return false;
    } catch (err: any) {
      setState((s) => ({ ...s, error: `SDK init error: ${err}` }));
      return false;
    }
  }, []);

  // Connect to a Canon camera by index
  const connect = useCallback(async (cameraIndex = 0): Promise<boolean> => {
    try {
      await invoke("canon_connect", { cameraIndex });
      await invoke("canon_open_session");

      // Start event polling (required for EDSDK to process async events)
      if (!eventPollIntervalRef.current) {
        eventPollIntervalRef.current = setInterval(async () => {
          try {
            await invoke("canon_process_events");
          } catch {
            // ignore event poll errors
          }
        }, 100);
      }

      setState((s) => ({ ...s, connected: true, error: "" }));
      return true;
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Connect error: ${err}` }));
      return false;
    }
  }, []);

  // Start live view and begin frame polling
  const startLiveView = useCallback(async (): Promise<boolean> => {
    try {
      await invoke("canon_start_live_view");

      // Poll live view frames at ~30fps
      if (liveViewIntervalRef.current) {
        clearInterval(liveViewIntervalRef.current);
      }

      liveViewIntervalRef.current = setInterval(async () => {
        if (isCleanedUpRef.current) return;
        try {
          const result = await invoke<{ success: boolean; imageData?: string }>(
            "canon_get_live_view_frame"
          );
          if (result.success && result.imageData) {
            const dataUrl = result.imageData.startsWith("data:")
              ? result.imageData
              : `data:image/jpeg;base64,${result.imageData}`;
            latestFrameRef.current = dataUrl;
            setState((s) => ({ ...s, liveViewFrame: dataUrl }));

            // If recording, accumulate frames
            if (isRecordingRef.current) {
              recordedFramesRef.current.push(dataUrl);
              recordedTimestampsRef.current.push(Date.now());
            }
          }
        } catch {
          // frame fetch failed — skip
        }
      }, 33); // ~30fps

      setState((s) => ({ ...s, liveViewActive: true, error: "" }));
      return true;
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Live view error: ${err}` }));
      return false;
    }
  }, []);

  // Stop live view
  const stopLiveView = useCallback(async () => {
    if (liveViewIntervalRef.current) {
      clearInterval(liveViewIntervalRef.current);
      liveViewIntervalRef.current = null;
    }
    try {
      await invoke("canon_stop_live_view");
    } catch {
      // ignore
    }
    setState((s) => ({ ...s, liveViewActive: false }));
  }, []);

  // Take a picture — returns base64 JPEG data URL
  // The backend handles: stopLV → capture → startLV
  const takePicture = useCallback(async (): Promise<string> => {
    try {
      // Pause live view polling during capture
      if (liveViewIntervalRef.current) {
        clearInterval(liveViewIntervalRef.current);
        liveViewIntervalRef.current = null;
      }

      // Stop live view for capture
      try {
        await invoke("canon_stop_live_view");
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 300));

      const result = await invoke<{ success: boolean; imageData?: string; error?: string }>(
        "canon_take_picture"
      );

      // Restart live view after capture
      try {
        await invoke("canon_start_live_view");
      } catch {
        // ignore
      }

      // Resume live view polling
      await new Promise((r) => setTimeout(r, 200));
      if (!isCleanedUpRef.current) {
        liveViewIntervalRef.current = setInterval(async () => {
          if (isCleanedUpRef.current) return;
          try {
            const frame = await invoke<{ success: boolean; imageData?: string }>(
              "canon_get_live_view_frame"
            );
            if (frame.success && frame.imageData) {
              const dataUrl = frame.imageData.startsWith("data:")
                ? frame.imageData
                : `data:image/jpeg;base64,${frame.imageData}`;
              latestFrameRef.current = dataUrl;
              setState((s) => ({ ...s, liveViewFrame: dataUrl }));
              if (isRecordingRef.current) {
                recordedFramesRef.current.push(dataUrl);
                recordedTimestampsRef.current.push(Date.now());
              }
            }
          } catch {
            // skip
          }
        }, 33);
      }

      if (result.success && result.imageData) {
        const dataUrl = result.imageData.startsWith("data:")
          ? result.imageData
          : `data:image/jpeg;base64,${result.imageData}`;
        return dataUrl;
      }

      console.error("Canon capture failed:", result.error);
      return "";
    } catch (err: any) {
      console.error("Canon takePicture error:", err);
      return "";
    }
  }, []);

  // Get the latest live view frame (instant, no async)
  const getLatestFrame = useCallback((): string => {
    return latestFrameRef.current;
  }, []);

  // Frame recording for video/boomerang
  const startFrameRecording = useCallback(() => {
    recordedFramesRef.current = [];
    recordedTimestampsRef.current = [];
    isRecordingRef.current = true;
  }, []);

  const stopFrameRecording = useCallback((): { frames: string[]; timestamps: number[] } => {
    isRecordingRef.current = false;
    const frames = [...recordedFramesRef.current];
    const timestamps = [...recordedTimestampsRef.current];
    recordedFramesRef.current = [];
    recordedTimestampsRef.current = [];
    return { frames, timestamps };
  }, []);

  // Full cleanup
  const cleanup = useCallback(async () => {
    isCleanedUpRef.current = true;
    isRecordingRef.current = false;

    if (liveViewIntervalRef.current) {
      clearInterval(liveViewIntervalRef.current);
      liveViewIntervalRef.current = null;
    }
    if (eventPollIntervalRef.current) {
      clearInterval(eventPollIntervalRef.current);
      eventPollIntervalRef.current = null;
    }

    try {
      await invoke("canon_stop_live_view");
    } catch {
      // ignore
    }
    try {
      await invoke("canon_close_session");
    } catch {
      // ignore
    }
    try {
      await invoke("canon_terminate");
    } catch {
      // ignore
    }

    setState({
      initialized: false,
      connected: false,
      liveViewActive: false,
      liveViewFrame: "",
      error: "",
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isCleanedUpRef.current = true;
      if (liveViewIntervalRef.current) clearInterval(liveViewIntervalRef.current);
      if (eventPollIntervalRef.current) clearInterval(eventPollIntervalRef.current);
      // Best-effort async cleanup
      invoke("canon_stop_live_view").catch(() => {});
      invoke("canon_close_session").catch(() => {});
      invoke("canon_terminate").catch(() => {});
    };
  }, []);

  return {
    ...state,
    initialize,
    connect,
    startLiveView,
    stopLiveView,
    takePicture,
    getLatestFrame,
    startFrameRecording,
    stopFrameRecording,
    cleanup,
  };
}
