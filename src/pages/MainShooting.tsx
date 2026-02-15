import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const sequenceRunningRef = useRef(false);

  const [captures, setCaptures] = useState<Capture[]>([]);
  const [, setCurrentCapture] = useState(0);
  const [countdown, setCountdown] = useState(-1);
  const [phase, setPhase] = useState<"ready" | "countdown" | "flash" | "preview" | "done">("ready");
  const [isRecording, setIsRecording] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
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

      if (type === "webcam") {
        await initWebcam();
      } else {
        // Canon DSLR - fallback to webcam for now
        await initWebcam();
      }
    } catch (err: any) {
      setCameraError("Camera not found. Please check connection.");
      console.error("Camera init error:", err);
    }
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
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startRecording = useCallback(() => {
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

  const takePhoto = useCallback((): string => {
    if (!videoRef.current || !canvasRef.current) return "";

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return "";

    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 1.0);
  }, []);

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

  // Start shooting sequence - no more double-firing
  const startShootingSequence = useCallback(async () => {
    if (sequenceRunningRef.current) return;
    sequenceRunningRef.current = true;

    const doCapture = async (captureIndex: number) => {
      if (captureIndex >= totalCaptures) {
        setPhase("done");
        sequenceRunningRef.current = false;
        return;
      }

      setPhase("countdown");
      setCountdown(cameraCountdown);

      // Determine when to start recording: always record last 3 seconds
      const recordStartAt = Math.min(cameraCountdown, 3);

      await new Promise<void>((resolve) => {
        let currentCount = cameraCountdown;

        // Start recording immediately if countdown <= 3
        if (cameraCountdown <= 3) {
          startRecording();
        }

        const timer = setInterval(async () => {
          currentCount--;
          setCountdown(currentCount);

          // Start recording when we reach recordStartAt seconds remaining
          // (for countdown > 3, start at 3 seconds left)
          if (currentCount === recordStartAt && cameraCountdown > 3 && !isRecordingRef.current) {
            startRecording();
          }

          if (currentCount <= 0) {
            clearInterval(timer);

            // Wait for video to be ready (async!)
            const { url: videoUrl, blob: videoBlob } = await waitForVideo();

            // Save video to temp file for later FFmpeg processing
            let videoPath = "";
            if (videoBlob) {
              videoPath = await saveVideoToTemp(videoBlob, captureIndex);
            }

            // Take photo
            const photoData = takePhoto();

            // Flash effect
            setShowFlash(true);
            setPhase("flash");

            setTimeout(async () => {
              setShowFlash(false);
              setPhase("preview");

              const newCapture: Capture = {
                photo: photoData,
                video: videoUrl,
                videoPath: videoPath,
              };

              setCaptures((prev) => [...prev, newCapture]);
              setCurrentCapture(captureIndex + 1);

              // Wait then proceed to next
              setTimeout(() => {
                if (captureIndex + 1 >= totalCaptures) {
                  setPhase("done");
                  sequenceRunningRef.current = false;
                } else {
                  doCapture(captureIndex + 1);
                }
              }, 2000);
            }, 300);

            resolve();
          }
        }, 1000);
      });
    };

    // Start from capture 0
    await doCapture(0);
  }, [totalCaptures, cameraCountdown, startRecording, waitForVideo, takePhoto, saveVideoToTemp]);

  // Auto-start after camera is initialized (single trigger, no double-fire)
  useEffect(() => {
    if (cameraReady && !cameraError) {
      const timer = setTimeout(() => {
        startShootingSequence();
      }, 2000);
      return () => clearTimeout(timer);
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
    const checkCamera = setInterval(() => {
      if (cameraType === "webcam" && streamRef.current) {
        const videoTrack = streamRef.current.getVideoTracks()[0];
        if (!videoTrack || videoTrack.readyState === "ended") {
          setCameraError("กล้องถูกถอดออก กรุณาเชื่อมต่อใหม่");
          setTimeout(() => navigate("/"), 3000);
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
      <div style={{ textAlign: "center", marginTop: "3%", zIndex: 5 }}>
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
          padding: "12px 24px 24px",
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
          }}
        >
          {Array.from({ length: totalCaptures }).map((_, idx) => {
            const slot = slots[0];
            const aspectRatio = slot ? `${slot.width} / ${slot.height}` : "3 / 4";
            return (
              <div
                key={idx}
                style={{
                  width: 70,
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
