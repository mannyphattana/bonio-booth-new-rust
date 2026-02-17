import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useCanon } from "../hooks/useCanon";

// CropOverlay: shows SVG mask overlay to indicate the crop area based on slot dimensions
function CropOverlay({
  slotWidth,
  slotHeight,
  videoWidth,
  videoHeight,
  containerWidth,
  containerHeight,
}: {
  slotWidth: number;
  slotHeight: number;
  videoWidth: number;
  videoHeight: number;
  containerWidth: number;
  containerHeight: number;
}) {
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight) return null;

  const slotRatio = slotWidth / slotHeight;
  const videoRatio = videoWidth / videoHeight;

  // Calculate the crop area within the container (object-fit: cover logic)
  let displayW = containerWidth;
  let displayH = containerHeight;
  const containerRatio = containerWidth / containerHeight;

  // Video is displayed with object-fit: cover, so it fills the container
  // and overflows on one axis
  if (videoRatio > containerRatio) {
    // Video is wider than container → cropped on sides
    displayH = containerHeight;
    displayW = containerHeight * videoRatio;
  } else {
    // Video is taller than container → cropped on top/bottom
    displayW = containerWidth;
    displayH = containerWidth / videoRatio;
  }

  // Calculate the crop rectangle in display coordinates
  let cropW: number, cropH: number;
  if (slotRatio > videoRatio) {
    // Slot is wider relative to video → full width, crop height
    cropW = displayW;
    cropH = displayW / slotRatio;
  } else {
    // Slot is taller relative to video → full height, crop width
    cropH = displayH;
    cropW = displayH * slotRatio;
  }

  // Clamp to container bounds for the visible overlay
  const visibleCropX = Math.max(0, (containerWidth - cropW) / 2);
  const visibleCropY = Math.max(0, (containerHeight - cropH) / 2);
  const visibleCropW = Math.min(cropW, containerWidth);
  const visibleCropH = Math.min(cropH, containerHeight);

  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <defs>
        <mask id="crop-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect
            x={visibleCropX}
            y={visibleCropY}
            width={visibleCropW}
            height={visibleCropH}
            fill="black"
          />
        </mask>
      </defs>
      {/* Semi-transparent overlay outside crop area */}
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.5)"
        mask="url(#crop-mask)"
      />
      {/* Dashed border around crop area */}
      <rect
        x={visibleCropX}
        y={visibleCropY}
        width={visibleCropW}
        height={visibleCropH}
        fill="none"
        stroke="rgba(255,255,255,0.7)"
        strokeWidth="2"
        strokeDasharray="8,4"
      />
    </svg>
  );
}

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function MainShooting({ theme, machineData }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const selectedFrame = state.selectedFrame;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  const cameraCountdown = machineData.cameraCountdown || 5;
  const totalSlots = slots.length || 4;
  const totalCaptures = totalSlots + 2; // slots + 2 extra

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const canonLiveViewRef = useRef<HTMLImageElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const sequenceRunningRef = useRef(false);
  const cameraTypeRef = useRef("webcam");

  const canonCamera = useCanon();

  const [captures, setCaptures] = useState<Capture[]>([]);
  const [, setCurrentCapture] = useState(0);
  const [countdown, setCountdown] = useState(-1);
  const [phase, setPhase] = useState<"ready" | "countdown" | "flash" | "preview" | "done">("ready");
  const [isRecording, setIsRecording] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showGetReady, setShowGetReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraType, setCameraType] = useState("webcam");
  const [cameraReady, setCameraReady] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({ width: 1920, height: 1080 });
  const [containerDimensions, setContainerDimensions] = useState({ width: 800, height: 600 });
  useIdleTimeout();

  // Track container dimensions for CropOverlay
  useEffect(() => {
    const updateContainerDimensions = () => {
      if (cameraContainerRef.current) {
        const rect = cameraContainerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    };
    updateContainerDimensions();
    window.addEventListener("resize", updateContainerDimensions);
    return () => window.removeEventListener("resize", updateContainerDimensions);
  }, []);

  // Initialize camera
  useEffect(() => {
    initCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const initCamera = async () => {
    try {
      const type: string = await invoke("get_camera_type");
      setCameraType(type);
      cameraTypeRef.current = type;

      if (type === "webcam") {
        await initWebcam();
      } else {
        // Canon DSLR
        await initCanon();
      }
    } catch (err: any) {
      setCameraError("Camera not found. Please check connection.");
      console.error("Camera init error:", err);
    }
  };

  const initCanon = async () => {
    // 1. Initialize SDK
    console.log("[Canon] Initializing SDK...");
    const sdkOk = await canonCamera.initialize();
    if (!sdkOk) {
      console.error("[Canon] SDK initialization failed");
      setCameraError("Canon SDK initialization failed");
      return;
    }
    console.log("[Canon] SDK initialized OK");

    // 2. Connect to camera (index 0 by default)
    console.log("[Canon] Connecting to camera...");
    const connOk = await canonCamera.connect(0);
    if (!connOk) {
      console.error("[Canon] Cannot connect to camera");
      setCameraError("Cannot connect to Canon camera");
      return;
    }
    console.log("[Canon] Camera connected OK");

    // Brief delay to let camera settle after session open
    await new Promise((r) => setTimeout(r, 300));

    // 3. Start live view (with retry — Canon cameras need a brief pause after session open)
    let lvOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Canon] Starting live view (attempt ${attempt}/3)...`);
      lvOk = await canonCamera.startLiveView();
      if (lvOk) break;
      // Wait before retry — camera may need time after session open
      console.warn(`[Canon] Live view attempt ${attempt} failed, retrying in ${attempt * 500}ms...`);
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
    if (!lvOk) {
      console.error("[Canon] Cannot start live view after 3 attempts — cleaning up");
      // Cleanup so the camera isn't left in a half-open state
      await canonCamera.cleanup();
      setCameraError("Cannot start Canon live view");
      return;
    }

    // 4. Wait for first frame (up to 3 seconds)
    let waitTime = 0;
    while (!canonCamera.liveViewFrame && waitTime < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      waitTime += 100;
    }

    // 5. Set Canon dimensions (live view is typically 1920x1280)
    setVideoDimensions({ width: 1920, height: 1280 });
    setCameraReady(true);

    // Update container dimensions
    setTimeout(() => {
      if (cameraContainerRef.current) {
        const rect = cameraContainerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    }, 100);
  };

  const initWebcam = async () => {
    // Stop any existing stream first
    stopCamera();

    // Try with ideal constraints first, then fallback
    const constraints = [
      {
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      },
      { video: true, audio: false },
    ];

    let lastErr: any;
    for (const constraint of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraint);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await new Promise<void>((resolve) => {
            videoRef.current!.onloadedmetadata = () => {
              const vw = videoRef.current!.videoWidth;
              const vh = videoRef.current!.videoHeight;
              if (vw > 0 && vh > 0) {
                setVideoDimensions({ width: vw, height: vh });
              }
              resolve();
            };
          });
          await videoRef.current.play();
        }
        setCameraReady(true);
        // Update container dimensions after camera is ready
        setTimeout(() => {
          if (cameraContainerRef.current) {
            const rect = cameraContainerRef.current.getBoundingClientRect();
            setContainerDimensions({ width: rect.width, height: rect.height });
          }
        }, 100);
        return; // success
      } catch (err: any) {
        lastErr = err;
        // If NotReadable, wait a bit for the device to be released
        if (err.name === "NotReadableError") {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    setCameraError("ไม่พบกล้อง กรุณาตรวจสอบการเชื่อมต่อ");
    throw lastErr;
  };

  const stopCamera = () => {
    if (cameraTypeRef.current === "canon") {
      canonCamera.cleanup();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startRecording = useCallback(() => {
    if (cameraTypeRef.current === "canon") {
      // Canon: use EDSDK movie recording (real 1080p 30fps video from camera)
      canonCamera.startMovieRecording().then((ok) => {
        if (ok) {
          setIsRecording(true);
          console.log("[Canon] Movie recording started via EDSDK");
        } else {
          // Fallback: accumulate live view frames
          console.warn("[Canon] Movie recording failed, falling back to frame capture");
          canonCamera.startFrameRecording();
          setIsRecording(true);
          (window as any).__canonMovieFallback = true;
        }
      });
      return;
    }

    // Webcam: use MediaRecorder
    if (!streamRef.current || isRecordingRef.current) return;

    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType,
      videoBitsPerSecond: 15000000,
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      (window as any).__lastVideoUrl = url;
      (window as any).__lastVideoBlob = blob;
      (window as any).__lastVideoReady = true;
    };

    (window as any).__lastVideoReady = false;
    (window as any).__lastVideoUrl = "";
    (window as any).__lastVideoBlob = null;
    recorder.start();
    mediaRecorderRef.current = recorder;
    isRecordingRef.current = true;
    setIsRecording(true);
  }, []);

  // Wait for video blob to be ready after stopping recording
  const waitForVideo = useCallback((): Promise<{ url: string; blob: Blob | null }> => {
    if (cameraTypeRef.current === "canon") {
      // Canon: stop frame recording and create video from accumulated frames
      const recording = canonCamera.stopFrameRecording();
      isRecordingRef.current = false;
      setIsRecording(false);

      if (recording.frames.length > 0) {
        // Create video from recorded JPEG frames using canvas + MediaRecorder
        return createVideoFromFrames(recording.frames).then((result) => result);
      }
      return Promise.resolve({ url: "", blob: null });
    }

    // Webcam: standard MediaRecorder flow
    return new Promise((resolve) => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      isRecordingRef.current = false;
      setIsRecording(false);

      // Poll until onstop callback fires and sets __lastVideoReady
      const check = setInterval(() => {
        if ((window as any).__lastVideoReady) {
          clearInterval(check);
          resolve({
            url: (window as any).__lastVideoUrl || "",
            blob: (window as any).__lastVideoBlob || null,
          });
        }
      }, 50);

      // Timeout after 3 seconds
      setTimeout(() => {
        clearInterval(check);
        resolve({
          url: (window as any).__lastVideoUrl || "",
          blob: (window as any).__lastVideoBlob || null,
        });
      }, 3000);
    });
  }, []);

  const takePhoto = useCallback(async (): Promise<string> => {
    if (cameraTypeRef.current === "canon") {
      // Canon: use EDSDK shutter capture
      const photo = await canonCamera.takePicture();
      return photo;
    }

    // Webcam: grab frame from video element
    if (!videoRef.current || !canvasRef.current) return "";

    const video = videoRef.current;
    const canvas = canvasRef.current;

    // Cap photo resolution to 1920px max dimension (webcam may report higher)
    const maxDim = 1920;
    let w = video.videoWidth;
    let h = video.videoHeight;
    if (w > maxDim || h > maxDim) {
      const ratio = Math.min(maxDim / w, maxDim / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  // Create video from JPEG frames (used for Canon frame recording)
  // Dynamically calculates fps so the output is always exactly `targetDurationSec` (default 3s).
  // e.g. 60 frames → 20fps × 3s, 45 frames → 15fps × 3s, 20 frames → 6.67fps × 3s
  // This guarantees every slot has identical video duration for clean looping.
  const createVideoFromFrames = useCallback(
    async (frames: string[], targetDurationSec: number = 3): Promise<{ url: string; blob: Blob | null }> => {
      if (frames.length === 0) return { url: "", blob: null };

      // Calculate fps dynamically: frames / target duration
      // Clamp between 5 (minimum smooth) and 30 (maximum practical)
      const dynamicFps = Math.max(5, Math.min(30, frames.length / targetDurationSec));
      console.log(`[createVideoFromFrames] ${frames.length} frames / ${targetDurationSec}s = ${dynamicFps.toFixed(2)}fps`);

      return new Promise((resolve) => {
        const offCanvas = document.createElement("canvas");
        offCanvas.width = 1920;
        offCanvas.height = 1280;
        // alpha:false → opaque canvas, avoids premultiplied-alpha color shift
        // colorSpace:'srgb' → ensures consistent sRGB color matching the source JPEGs
        const ctx = offCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
        if (!ctx) {
          resolve({ url: "", blob: null });
          return;
        }

        const stream = offCanvas.captureStream(dynamicFps);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm";
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          resolve({ url, blob });
        };

        recorder.start();

        let frameIdx = 0;
        const interval = setInterval(() => {
          if (frameIdx >= frames.length) {
            clearInterval(interval);
            recorder.stop();
            return;
          }

          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height);
          };
          img.src = frames[frameIdx];
          frameIdx++;
        }, 1000 / dynamicFps);
      });
    },
    []
  );

  // Save video blob to temp file for FFmpeg processing
  const saveVideoToTemp = useCallback(async (blob: Blob, index: number): Promise<string> => {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const base64 = btoa(
        uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const path: string = await invoke("save_temp_video", {
        videoDataBase64: base64,
        filename: `capture_${index}.webm`,
      });
      return path;
    } catch (err) {
      console.error("Failed to save video to temp:", err);
      return "";
    }
  }, []);

  // Start shooting sequence - optimized flow matching old project
  // Flow: Get Ready → [countdown → stopRecording → takePhoto → flash → bg video → 1.5s wait] × N
  const startShootingSequence = useCallback(async () => {
    if (sequenceRunningRef.current) return;
    sequenceRunningRef.current = true;

    // ========================================
    // Step 1: Wait for camera to be truly ready (fresh-frame detection)
    // Canon: wait for 2 consecutive unique frames (exposure/focus settled)
    // Webcam: fixed 1.5s warmup delay
    // ========================================
    if (cameraTypeRef.current === "canon") {
      const FRESH_FRAME_TIMEOUT = 5000; // 5 seconds max wait
      const POLL_MS = 50;
      let elapsed = 0;
      let lastFingerprint = "";
      let freshCount = 0;
      const REQUIRED_FRESH = 2;

      console.log("[Canon] Waiting for fresh frames before first capture...");
      setShowGetReady(true);

      while (elapsed < FRESH_FRAME_TIMEOUT && freshCount < REQUIRED_FRESH) {
        const frame = canonCamera.getLatestFrame();
        if (frame) {
          // Fingerprint: length + last 100 chars (JPEG tail changes most)
          const fp = `${frame.length}:${frame.slice(-100)}`;
          if (fp !== lastFingerprint) {
            freshCount++;
            lastFingerprint = fp;
            console.log(`[Canon] Fresh frame ${freshCount}/${REQUIRED_FRESH} after ${elapsed}ms`);
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        elapsed += POLL_MS;
      }

      setShowGetReady(false);
      if (freshCount >= REQUIRED_FRESH) {
        console.log(`[Canon] Camera ready — ${freshCount} fresh frames in ${elapsed}ms`);
      } else {
        console.warn(`[Canon] Fresh frame timeout after ${elapsed}ms (got ${freshCount}/${REQUIRED_FRESH}) — proceeding anyway`);
      }
    } else {
      // Webcam: fixed warmup delay for exposure/white balance
      console.log("[Webcam] Warming up camera...");
      setShowGetReady(true);
      await new Promise((r) => setTimeout(r, 1500));
      setShowGetReady(false);
    }

    console.log("[Capture] Camera warm-up done, starting capture loop");

    // ========================================
    // Step 2: Capture loop
    // ========================================
    for (let i = 0; i < totalCaptures; i++) {
      console.log(`[Capture] Starting capture ${i + 1}/${totalCaptures}`);

      // --- Countdown with video recording ---
      setPhase("countdown");
      const recordStartAt = Math.min(cameraCountdown, 3);

      await new Promise<void>((resolve) => {
        let currentCount = cameraCountdown;
        setCountdown(currentCount);

        // Start recording immediately if countdown <= 3
        if (cameraCountdown <= 3) {
          startRecording();
        }

        const timer = setInterval(() => {
          currentCount--;
          setCountdown(currentCount);

          // Start recording at 3 seconds remaining (for countdown > 3)
          if (currentCount === recordStartAt && cameraCountdown > 3 && !isRecordingRef.current) {
            startRecording();
          }

          if (currentCount <= 0) {
            clearInterval(timer);
            resolve();
          }
        }, 1000);
      });

      // --- Countdown reached 0 → capture immediately ---

      // 1. Stop recording
      let recordingResult: { url: string; blob: Blob | null } = { url: "", blob: null };
      let canonMoviePath = "";

      if (cameraTypeRef.current === "canon") {
        if ((window as any).__canonMovieFallback) {
          // Fallback: stop frame recording, get raw frames
          const recording = canonCamera.stopFrameRecording();
          isRecordingRef.current = false;
          setIsRecording(false);
          (window as any).__lastCanonFrames = recording.frames;
          (window as any).__canonMovieFallback = false;
        } else {
          // Real movie recording: stop and download from camera
          // Note: stopMovieRecording is blocking — camera writes file then transfers
          isRecordingRef.current = false;
          setIsRecording(false);
          canonMoviePath = await canonCamera.stopMovieRecording();
          console.log(`[Canon] Movie file: ${canonMoviePath}`);
        }
      } else {
        // Webcam: stop MediaRecorder and wait for blob
        recordingResult = await waitForVideo();
      }

      // 2. Take photo IMMEDIATELY (no blocking video processing first!)
      const photoData = await takePhoto();

      // 3. Flash effect
      setShowFlash(true);
      setPhase("flash");
      await new Promise((r) => setTimeout(r, 300));
      setShowFlash(false);

      // 4. Save video
      let videoUrl = "";
      let videoPath = "";

      if (cameraTypeRef.current === "canon") {
        if (canonMoviePath) {
          // Real EDSDK movie: file already on disk from camera
          videoPath = canonMoviePath;
          console.log(`[Canon] Using EDSDK movie file: ${videoPath}`);
        } else {
          // Fallback: create video from JPEG frames in background
          const frames = (window as any).__lastCanonFrames as string[] || [];
          if (frames.length > 0) {
            const captureIndex = i;
            console.log(`[Canon] Fallback: creating video from ${frames.length} frames...`);
            createVideoFromFrames(frames)
              .then(async (result) => {
                console.log(`[Canon] Background video ready for capture ${captureIndex + 1}`);
                if (result.blob) {
                  const path = await saveVideoToTemp(result.blob, captureIndex);
                  setCaptures((prev) => {
                    const updated = [...prev];
                    if (updated[captureIndex]) {
                      updated[captureIndex] = {
                        ...updated[captureIndex],
                        video: result.url,
                        videoPath: path,
                      };
                    }
                    return updated;
                  });
                }
              })
              .catch((err) => {
                console.error(`[Canon] Background video processing failed:`, err);
              });
          }
          (window as any).__lastCanonFrames = null;
        }
      } else {
        // Webcam: video is already ready
        videoUrl = recordingResult.url;
        if (recordingResult.blob) {
          videoPath = await saveVideoToTemp(recordingResult.blob, i);
        }
      }

      // 5. Add capture to state
      const newCapture: Capture = {
        photo: photoData,
        video: videoUrl,
        videoPath: videoPath,
      };
      setCaptures((prev) => [...prev, newCapture]);
      setCurrentCapture(i + 1);
      setPhase("preview");

      console.log(`[Capture] Capture ${i + 1}/${totalCaptures} completed`);

      // 6. Check if done
      if (i + 1 >= totalCaptures) {
        setPhase("done");
        sequenceRunningRef.current = false;
        break;
      }

      // 7. Wait 1.5s before next capture (camera stabilization, matching old project)
      await new Promise((r) => setTimeout(r, 1500));
    }
  }, [totalCaptures, cameraCountdown, startRecording, waitForVideo, takePhoto, saveVideoToTemp, createVideoFromFrames]);

  // Auto-start after camera is initialized (single trigger, no double-fire)
  // No artificial delay — Get Ready screen handles the camera warm-up
  useEffect(() => {
    if (cameraReady && !cameraError) {
      startShootingSequence();
    }
  }, [cameraReady, cameraError]);

  // Navigate when done
  useEffect(() => {
    if (phase === "done" && captures.length >= totalCaptures) {
      setTimeout(() => {
        navigate("/slot-selection", {
          state: {
            ...state,
            captures,
          },
        });
      }, 1500);
    }
  }, [phase, captures, totalCaptures]);

  // Camera disconnect check
  useEffect(() => {
    const checkCamera = setInterval(async () => {
      if (cameraType === "webcam" && streamRef.current) {
        const videoTrack = streamRef.current.getVideoTracks()[0];
        if (!videoTrack || videoTrack.readyState === "ended") {
          setCameraError("กล้องถูกถอดออก กรุณาเชื่อมต่อใหม่");
          setTimeout(() => navigate("/"), 3000);
        }
      } else if (cameraType === "canon") {
        try {
          const connected = await invoke<boolean>("canon_is_connected");
          if (!connected) {
            setCameraError("กล้อง Canon ถูกถอดออก กรุณาเชื่อมต่อใหม่");
            setTimeout(() => navigate("/"), 3000);
          }
        } catch {
          // ignore check errors
        }
      }
    }, 2000);

    return () => clearInterval(checkCamera);
  }, [cameraType, navigate]);

  // Determine current slot for CropOverlay guideline
  const getCurrentSlot = (): FrameSlot | null => {
    if (!slots.length) return null;
    const currentIndex = captures.length;
    // For extra captures (beyond slot count), use slot[0]
    if (currentIndex >= slots.length) return slots[0];
    return slots[currentIndex];
  };

  if (cameraError) {
    return (
      <div className="page-container" style={{ backgroundImage: `url(${theme.backgroundSecond})` }}>
        <div className="error-modal-overlay">
          <div className="error-modal">
            <h2>⚠️ Camera Error</h2>
            <p>{cameraError}</p>
            <button onClick={() => navigate("/")}>กลับหน้าหลัก</button>
          </div>
        </div>
      </div>
    );
  }

  const currentSlot = getCurrentSlot();

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        overflow: "hidden",
      }}
    >
      {/* Title */}
      <div style={{ textAlign: "center", marginTop: "160px", zIndex: 5 }}>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 700, color: theme.fontColor, margin: "0 0 4px" }}>
          มองกล้อง!
        </h1>
        <p style={{ fontSize: "1.2rem", fontWeight: 500, color: theme.fontColor, margin: 0, letterSpacing: 0.5, textTransform: "uppercase" }}>
          LET'S TAKE A PHOTO
        </p>
      </div>

      {/* Camera view */}
      <div
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 24px",
          minHeight: 0,
        }}
      >
        <div
          ref={cameraContainerRef}
          style={{
            position: "relative",
            width: "85%",
            maxHeight: "60vh",
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            background: "rgba(0,0,0,0.2)",
            aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}`,
          }}
        >
          {/* Webcam: <video> element */}
          {cameraType === "webcam" && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)", // Mirror
                borderRadius: 20,
              }}
            />
          )}

          {/* Canon: <img> element with live view frames */}
          {cameraType === "canon" && canonCamera.liveViewFrame && (
            <img
              ref={canonLiveViewRef}
              src={canonCamera.liveViewFrame}
              alt="Canon Live View"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)", // Mirror
                borderRadius: 20,
              }}
            />
          )}

          {/* Canon waiting state */}
          {cameraType === "canon" && !canonCamera.liveViewFrame && cameraReady && (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgba(255,255,255,0.6)",
                fontSize: 18,
              }}
            >
              Waiting for Canon Live View...
            </div>
          )}

          {/* Get Ready overlay — shown while waiting for camera to settle */}
          {showGetReady && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.4)",
                zIndex: 25,
              }}
            >
              <div
                style={{
                  fontSize: 48,
                  fontWeight: 800,
                  color: "#fff",
                  textShadow: "0 4px 20px rgba(0,0,0,0.5)",
                  marginBottom: 12,
                }}
              >
                เตรียมตัว!
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.8)",
                  textShadow: "0 2px 10px rgba(0,0,0,0.4)",
                  textTransform: "uppercase",
                  letterSpacing: 2,
                }}
              >
                GET READY
              </div>
            </div>
          )}

          {/* CropOverlay guideline */}
          {currentSlot && cameraReady && (
            <CropOverlay
              slotWidth={currentSlot.width}
              slotHeight={currentSlot.height}
              videoWidth={videoDimensions.width}
              videoHeight={videoDimensions.height}
              containerWidth={containerDimensions.width}
              containerHeight={containerDimensions.height}
            />
          )}

          {/* Countdown overlay */}
          {phase === "countdown" && countdown > 0 && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,0.15)",
                zIndex: 20,
              }}
            >
              <div
                style={{
                  fontSize: 120,
                  fontWeight: 900,
                  color: "#fff",
                  textShadow: "0 4px 20px rgba(0,0,0,0.5)",
                  animation: "countdownPulse 1s ease-in-out infinite",
                }}
              >
                {countdown}
              </div>
            </div>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div
              style={{
                position: "absolute",
                top: 16,
                left: 16,
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(0,0,0,0.5)",
                padding: "6px 12px",
                borderRadius: 20,
                zIndex: 15,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "#e94560",
                  animation: "blink 1s infinite",
                }}
              />
              <span style={{ fontSize: 12, color: "#fff" }}>REC</span>
            </div>
          )}

          {/* Flash effect */}
          {showFlash && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "#fff",
                animation: "flashAnim 0.3s ease-out forwards",
                zIndex: 30,
              }}
            />
          )}

          {/* Capture count */}
          <div
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "rgba(0,0,0,0.6)",
              padding: "8px 16px",
              borderRadius: 20,
              fontSize: 16,
              fontWeight: 600,
              color: "#fff",
              zIndex: 15,
            }}
          >
            {captures.length} / {totalCaptures}
          </div>
        </div>
      </div>

      {/* Preview thumbnails at bottom center */}
      <div
        style={{
          width: "100%",
          padding: "12px 24px 60px",
          display: "flex",
          justifyContent: "center",
          flexShrink: 0,
          zIndex: 5,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 12,
            overflowX: "auto",
            padding: "4px 8px",
            justifyContent: "center",
            width: "100%",
            maxWidth: 600,
          }}
        >
          {Array.from({ length: totalCaptures }).map((_, idx) => {
            const slot = slots[0];
            const aspectRatio = slot ? `${slot.width} / ${slot.height}` : "3 / 4";
            return (
              <div
                key={idx}
                style={{
                  width: `calc(25% - 10px)`,
                  maxWidth: 100,
                  aspectRatio,
                  borderRadius: 8,
                  overflow: "hidden",
                  flexShrink: 0,
                  border: captures[idx]
                    ? "2px solid rgba(255,255,255,0.6)"
                    : "2px dashed rgba(255,255,255,0.2)",
                  background: captures[idx] ? "transparent" : "rgba(0,0,0,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {captures[idx] ? (
                  <img
                    src={captures[idx].photo}
                    alt={`Capture ${idx + 1}`}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 18, fontWeight: 600 }}>
                    {idx + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      <style>{`
        @keyframes countdownPulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes flashAnim {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
