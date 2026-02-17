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
 *
 * IMPORTANT — EDSDK is single-threaded COM:
 * ALL EDSDK FFI calls MUST be serialized (never two calls on different threads
 * at the same time).  We achieve this by:
 *   • Having only ONE polling interval active at a time (LV frame polling).
 *     The Rust side of canon_get_live_view_frame also pumps EdsGetEvent().
 *   • Stopping all polling BEFORE any other EDSDK invoke (start/stop LV,
 *     take picture, etc.) and restarting AFTER.
 *   • No separate event-polling interval — events are processed inside the
 *     LV frame grab, and during capture the Rust event loop handles them.
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
  const latestFrameRef = useRef<string>("");
  const isCleanedUpRef = useRef(false);

  // Capture guards
  const isCapturingRef = useRef(false);
  const captureNumberRef = useRef(0);

  // Frame recording for video/boomerang
  const isRecordingRef = useRef(false);
  const recordedFramesRef = useRef<string[]>([]);
  const recordedTimestampsRef = useRef<number[]>([]);

  // ----- Helper: start/stop LV frame polling -----
  // This is the ONLY polling interval.  The Rust function also calls
  // EdsGetEvent() so SDK events are processed automatically.

  const startLiveViewPolling = useCallback(() => {
    if (liveViewIntervalRef.current) {
      clearInterval(liveViewIntervalRef.current);
    }

    liveViewIntervalRef.current = setInterval(async () => {
      if (isCleanedUpRef.current || isCapturingRef.current) return;
      try {
        const result = await invoke<{ data: string } | null>(
          "canon_get_live_view_frame"
        );
        if (result && result.data) {
          const dataUrl = result.data.startsWith("data:")
            ? result.data
            : `data:image/jpeg;base64,${result.data}`;
          latestFrameRef.current = dataUrl;
          setState((s) => ({ ...s, liveViewFrame: dataUrl }));

          // If recording, accumulate frames
          if (isRecordingRef.current) {
            recordedFramesRef.current.push(dataUrl);
            recordedTimestampsRef.current.push(Date.now());
          }
        }
      } catch {
        // frame fetch failed — skip (normal during transitions)
      }
    }, 33); // ~30fps
  }, []);

  const stopLiveViewPolling = useCallback(() => {
    if (liveViewIntervalRef.current) {
      clearInterval(liveViewIntervalRef.current);
      liveViewIntervalRef.current = null;
    }
  }, []);

  // Initialize Canon SDK
  const initialize = useCallback(async (): Promise<boolean> => {
    try {
      await invoke<boolean>("canon_initialize");
      setState((s) => ({ ...s, initialized: true, error: "" }));
      return true;
    } catch (err: any) {
      const errorMsg = typeof err === "string" ? err : JSON.stringify(err);
      console.error("[useCanon] SDK init error:", errorMsg);
      setState((s) => ({ ...s, error: `SDK init error: ${errorMsg}` }));
      return false;
    }
  }, []);

  // Connect to a Canon camera by index
  // NOTE: no polling is started here — polling begins only with startLiveView.
  const connect = useCallback(async (cameraIndex = 0): Promise<boolean> => {
    try {
      await invoke("canon_connect", { index: cameraIndex });
      await invoke("canon_open_session");
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
      startLiveViewPolling();
      setState((s) => ({ ...s, liveViewActive: true, error: "" }));
      return true;
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Live view error: ${err}` }));
      return false;
    }
  }, [startLiveViewPolling]);

  // Stop live view
  const stopLiveView = useCallback(async () => {
    stopLiveViewPolling();
    try {
      await invoke("canon_stop_live_view");
    } catch {
      // ignore
    }
    setState((s) => ({ ...s, liveViewActive: false }));
  }, [stopLiveViewPolling]);

  /**
   * Take a picture — returns base64 JPEG data URL.
   *
   * Flow:
   * 1. Guard: prevent concurrent captures
   * 2. Stop LV polling (ensures no EDSDK calls from JS)
   * 3. Stop camera live view + brief stabilization
   * 4. Send capture command (Rust side calls EdsGetEvent in its own loop)
   * 5. Restart live view + polling
   */
  const takePicture = useCallback(async (): Promise<string> => {
    // 1. Prevent concurrent captures
    if (isCapturingRef.current) {
      console.warn("[useCanon] Capture already in progress, skipping");
      return "";
    }

    captureNumberRef.current++;
    const captureNum = captureNumberRef.current;
    isCapturingRef.current = true;

    console.log(`[useCanon] Starting capture #${captureNum}...`);

    try {
      // 2. Stop ALL polling first — no EDSDK calls from JS after this point
      stopLiveViewPolling();

      // 3. Stop camera live view
      try {
        await invoke("canon_stop_live_view");
      } catch {
        // LV wasn't active, fine
      }
      // Brief stabilization for sensor
      await new Promise((r) => setTimeout(r, 50));

      // 4. Take picture (Rust function blocks until image download completes,
      //    pumps EdsGetEvent internally)
      const result = await invoke<{
        success: boolean;
        image_data?: string;
        error?: string;
      }>("canon_take_picture");

      // 5. Restart live view + polling
      isCapturingRef.current = false;
      try {
        await invoke("canon_start_live_view");
      } catch {
        // ignore
      }
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }

      if (result.success && result.image_data) {
        const dataUrl = result.image_data.startsWith("data:")
          ? result.image_data
          : `data:image/jpeg;base64,${result.image_data}`;
        console.log(`[useCanon] Capture #${captureNum} success`);
        return dataUrl;
      }

      console.error(`[useCanon] Capture #${captureNum} failed:`, result.error);
      return "";
    } catch (err: any) {
      console.error(`[useCanon] Capture #${captureNum} error:`, err);

      // Always try to recover
      isCapturingRef.current = false;
      try {
        await invoke("canon_start_live_view");
      } catch { /* ignore */ }
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }

      return "";
    }
  }, [stopLiveViewPolling, startLiveViewPolling]);

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

  // ===== EDSDK Movie Recording (real camera video) =====

  /**
   * Start real movie recording on the camera via EDSDK.
   * The camera records to its SD card at 1080p 30fps.
   * Live view polling is paused during recording (EDSDK is single-threaded).
   */
  const startMovieRecording = useCallback(async (): Promise<boolean> => {
    try {
      stopLiveViewPolling();
      console.log("[useCanon] Starting movie recording...");
      await invoke("canon_start_movie_record");
      // Resume live view polling so preview remains visible during recording
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }
      console.log("[useCanon] Movie recording started");
      return true;
    } catch (err: any) {
      console.error("[useCanon] startMovieRecording error:", err);
      // Try to resume live view even on error
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }
      return false;
    }
  }, [stopLiveViewPolling, startLiveViewPolling]);

  /**
   * Stop movie recording, wait for the camera to finalize and download the file.
   * Returns the local path to the downloaded MP4/MOV file on success, or "" on failure.
   * This is a blocking call — the camera needs to write and transfer the movie file.
   */
  const stopMovieRecording = useCallback(async (): Promise<string> => {
    try {
      stopLiveViewPolling();
      console.log("[useCanon] Stopping movie recording...");
      const moviePath: string = await invoke("canon_stop_movie_record");
      console.log("[useCanon] Movie file downloaded:", moviePath);
      // Restart live view + polling
      try {
        await invoke("canon_start_live_view");
      } catch { /* ignore */ }
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }
      return moviePath;
    } catch (err: any) {
      console.error("[useCanon] stopMovieRecording error:", err);
      // Try to recover
      try {
        await invoke("canon_start_live_view");
      } catch { /* ignore */ }
      if (!isCleanedUpRef.current) {
        startLiveViewPolling();
      }
      return "";
    }
  }, [stopLiveViewPolling, startLiveViewPolling]);

  /**
   * Check if camera is currently recording a movie
   */
  const isMovieRecording = useCallback(async (): Promise<boolean> => {
    try {
      return await invoke<boolean>("canon_is_movie_recording");
    } catch {
      return false;
    }
  }, []);

  // Full cleanup
  const cleanup = useCallback(async () => {
    isCleanedUpRef.current = true;
    isRecordingRef.current = false;
    isCapturingRef.current = false;

    stopLiveViewPolling();

    try { await invoke("canon_stop_live_view"); } catch { /* ignore */ }
    try { await invoke("canon_close_session"); } catch { /* ignore */ }
    try { await invoke("canon_terminate"); } catch { /* ignore */ }

    setState({
      initialized: false,
      connected: false,
      liveViewActive: false,
      liveViewFrame: "",
      error: "",
    });
  }, [stopLiveViewPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isCleanedUpRef.current = true;
      if (liveViewIntervalRef.current) clearInterval(liveViewIntervalRef.current);
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
    startMovieRecording,
    stopMovieRecording,
    isMovieRecording,
    cleanup,
  };
}
