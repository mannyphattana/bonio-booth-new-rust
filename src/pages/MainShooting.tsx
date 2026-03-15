import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useCanon } from "../hooks/useCanon";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";
import { logError } from "../utils/logger";

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
  if (!containerWidth || !containerHeight || !videoWidth || !videoHeight)
    return null;

  const slotRatio = slotWidth / slotHeight;
  const videoRatio = videoWidth / videoHeight;

  let displayW = containerWidth;
  let displayH = containerHeight;
  const containerRatio = containerWidth / containerHeight;

  if (videoRatio > containerRatio) {
    displayH = containerHeight;
    displayW = containerHeight * videoRatio;
  } else {
    displayW = containerWidth;
    displayH = containerWidth / videoRatio;
  }

  let cropW: number, cropH: number;
  if (slotRatio > videoRatio) {
    cropW = displayW;
    cropH = displayW / slotRatio;
  } else {
    cropH = displayH;
    cropW = displayH * slotRatio;
  }

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
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.5)"
        mask="url(#crop-mask)"
      />
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
  onFormatReset: () => void;
  onBeforeClose?: () => void;
  /** Called instead of navigate when running inside the camera window (dual-monitor mode) */
  onShootingComplete?: (captures: Capture[], selectedFrame: any, locationState: any) => void;
}

export default function MainShooting({ theme, machineData, onFormatReset, onBeforeClose, onShootingComplete }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const selectedFrame = state.selectedFrame;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  /** ส่งต่อ captures ไปยัง slot-selection หรือ callback (dual monitor) */
  const completeSession = useCallback(
    (captureList: Capture[]) => {
      const targetState = {
        ...state,
        captures: captureList,
        captureVideoDiagnostics: captureVideoDiagnosticsRef.current,
      };
      if (onShootingComplete) {
        onShootingComplete(captureList, selectedFrame, targetState);
      } else {
        navigate("/slot-selection", { state: targetState });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [navigate, onShootingComplete, state, selectedFrame]
  );

  const cameraCountdown = Number(machineData.cameraCountdown) || 5;
  const totalSlots = slots.length || 4;
  const totalCaptures = totalSlots + 2; 

  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const canonLiveViewRef = useRef<HTMLImageElement>(null);
  
  // 🚨 เพิ่ม Refs สำหรับจำลอง Canon Live View ให้เป็น Webcam Stream
  const canonCanvasRef = useRef<HTMLCanvasElement>(null);
  const canonDrawLoopRef = useRef<number>(0);

  // 🚨 เปลี่ยนจาก RecordRTC เป็น MediaRecorder Native
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]); // 🚨 เก็บก้อนวิดีโอ
  const isRecordingRef = useRef(false);
  const sequenceRunningRef = useRef(false);
  const cameraTypeRef = useRef("webcam");
  const captureVideoDiagnosticsRef = useRef<
    Array<{
      captureIndex: number;
      status: "ok" | "missing";
      reason: string;
      blobSize: number;
      cameraType: string;
    }>
  >([]);

  const canonCamera = useCanon();

  const [captures, setCaptures] = useState<Capture[]>([]);
  const [, setCurrentCapture] = useState(0);
  const [countdown, setCountdown] = useState(-1);
  const [phase, setPhase] = useState<
    "ready" | "countdown" | "flash" | "preview" | "done"
  >("ready");
  const [isRecording, setIsRecording] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [showGetReady, setShowGetReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraType, setCameraType] = useState("webcam");
  const [cameraReady, setCameraReady] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState({
    width: 1920,
    height: 1080,
  });
  const [containerDimensions, setContainerDimensions] = useState({
    width: 800,
    height: 600,
  });
  const [videosReadyTimeout, setVideosReadyTimeout] = useState(false);
  useIdleTimeout();

  useEffect(() => {
    const updateContainerDimensions = () => {
      if (cameraContainerRef.current) {
        const rect = cameraContainerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    };
    updateContainerDimensions();
    window.addEventListener("resize", updateContainerDimensions);
    return () =>
      window.removeEventListener("resize", updateContainerDimensions);
  }, []);

  useEffect(() => {
    initCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const drawCanonFrame = useCallback(() => {
    if (cameraTypeRef.current === "canon" && canonCanvasRef.current && canonLiveViewRef.current) {
      const ctx = canonCanvasRef.current.getContext("2d");
      if (ctx) {
        ctx.drawImage(
          canonLiveViewRef.current,
          0,
          0,
          canonCanvasRef.current.width,
          canonCanvasRef.current.height
        );
      }
    }
    canonDrawLoopRef.current = requestAnimationFrame(drawCanonFrame);
  }, []);

  const initCamera = async () => {
    try {
      const type: string = await invoke("get_camera_type");
      setCameraType(type);
      cameraTypeRef.current = type;

      if (type === "webcam") {
        await initWebcam();
      } else {
        await initCanon();
      }
    } catch (err: any) {
      setCameraError("Camera not found. Please check connection.");
      console.error("Camera init error:", err);
    }
  };

  const initCanon = async () => {
    console.log("[Canon] Initializing SDK...");
    const sdkOk = await canonCamera.initialize();
    if (!sdkOk) {
      setCameraError("Canon SDK initialization failed");
      return;
    }

    console.log("[Canon] Connecting to camera...");
    const connOk = await canonCamera.connect(0);
    if (!connOk) {
      setCameraError("Cannot connect to Canon camera");
      return;
    }

    await new Promise((r) => setTimeout(r, 300));

    let lvOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Canon] Starting live view (attempt ${attempt}/3)...`);
      lvOk = await canonCamera.startLiveView();
      if (lvOk) break;
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
    if (!lvOk) {
      await canonCamera.cleanup();
      setCameraError("Cannot start Canon live view");
      return;
    }

    let waitTime = 0;
    while (!canonCamera.liveViewFrame && waitTime < 3000) {
      await new Promise((r) => setTimeout(r, 100));
      waitTime += 100;
    }

    setVideoDimensions({ width: 1920, height: 1280 });
    setCameraReady(true);

    setTimeout(() => {
      if (cameraContainerRef.current) {
        const rect = cameraContainerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }

      if (canonCanvasRef.current) {
        canonCanvasRef.current.width = 1920;
        canonCanvasRef.current.height = 1280;
        streamRef.current = canonCanvasRef.current.captureStream(30);
        
        if (canonDrawLoopRef.current) cancelAnimationFrame(canonDrawLoopRef.current);
        drawCanonFrame();
      }
    }, 100);
  };

  const initWebcam = async () => {
    stopCamera();

    const constraints = [
      {
        video: {
          width: { ideal: 2560 },
          height: { ideal: 1440 },
          frameRate: { ideal: 30, min: 30 }, 
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, min: 30 }, 
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
        setTimeout(() => {
          if (cameraContainerRef.current) {
            const rect = cameraContainerRef.current.getBoundingClientRect();
            setContainerDimensions({ width: rect.width, height: rect.height });
          }
        }, 100);
        return; 
      } catch (err: any) {
        lastErr = err;
        if (err.name === "NotReadableError") {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    setCameraError("ไม่พบกล้อง กรุณาตรวจสอบการเชื่อมต่อ");
    throw lastErr;
  };

  const stopCamera = () => {
    if (canonDrawLoopRef.current) cancelAnimationFrame(canonDrawLoopRef.current);
    if (cameraTypeRef.current === "canon") {
      canonCamera.cleanup();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  // 🚨 เปลี่ยนมาใช้ MediaRecorder แบบ Native แท้ๆ ตัด RecordRTC ทิ้ง
  const startRecording = useCallback(() => {
    if (!streamRef.current || isRecordingRef.current) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
      ? "video/webm;codecs=vp8"
      : "video/webm";

    try {
      const recorder = new MediaRecorder(streamRef.current, {
        mimeType: mimeType as any,
        videoBitsPerSecond: 5000000, // 5 Mbps ชัดและเบาพอดี
      });

      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      setIsRecording(true);
    } catch (err) {
      console.error("Start recording failed:", err);
    }
  }, []);

  // 🚨 เปลี่ยนการคืนค่าของ waitForVideo ให้ใช้ Native
  const waitForVideo = useCallback((): Promise<{
    url: string;
    blob: Blob | null;
  }> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: "video/webm" });
          const url = URL.createObjectURL(blob);
          
          // เคลียร์แรมให้สะอาด
          chunksRef.current = [];
          mediaRecorderRef.current = null;

          isRecordingRef.current = false;
          setIsRecording(false);
          resolve({ url, blob });
        };
        recorder.stop();
      } else {
        isRecordingRef.current = false;
        setIsRecording(false);
        resolve({ url: "", blob: null });
      }
    });
  }, []);

  const takePhoto = useCallback(async (): Promise<string> => {
    if (cameraTypeRef.current === "canon") {
      const photo = await canonCamera.takePicture();
      return photo;
    }

    if (!videoRef.current || !canvasRef.current) return "";

    const video = videoRef.current;
    const canvas = canvasRef.current;

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

  const saveVideoToTemp = useCallback(
    async (blob: Blob, index: number): Promise<string> => {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64 = btoa(
          uint8Array.reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
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
    },
    []
  );

  const startShootingSequence = useCallback(async () => {
    if (sequenceRunningRef.current) return;
    sequenceRunningRef.current = true;

    if (cameraTypeRef.current === "canon") {
      const FRESH_FRAME_TIMEOUT = 5000; 
      const POLL_MS = 50;
      let elapsed = 0;
      let lastFingerprint = "";
      let freshCount = 0;
      const REQUIRED_FRESH = 2;

      setShowGetReady(true);
      const getReadyStart = Date.now();
      
      while (elapsed < FRESH_FRAME_TIMEOUT && freshCount < REQUIRED_FRESH) {
        const frame = canonCamera.getLatestFrame();
        if (frame) {
          const fp = `${frame.length}:${frame.slice(-100)}`;
          if (fp !== lastFingerprint) {
            freshCount++;
            lastFingerprint = fp;
          }
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
        elapsed += POLL_MS;
      }
      
      const getReadyElapsed = Date.now() - getReadyStart;
      if (getReadyElapsed < 1500) {
         await new Promise((r) => setTimeout(r, 1500 - getReadyElapsed));
      }
      setShowGetReady(false);
    } else {
      setShowGetReady(true);
      await new Promise((r) => setTimeout(r, 1500));
      setShowGetReady(false);
    }

      if (streamRef.current) {
        console.log("[Warm-up] อุ่นเครื่อง Video Encoder...");
        try {
          // 🚨 ปรับบิตเรตและ Codec ตอนวอร์มให้ตรงกับการอัดจริง
          const warmupRecorder = new MediaRecorder(streamRef.current, {
            mimeType: "video/webm;codecs=vp8",
            videoBitsPerSecond: 5000000
          });
          
          warmupRecorder.start();
          await new Promise((r) => setTimeout(r, 800)); 
          
          if (warmupRecorder.state !== "inactive") {
            warmupRecorder.stop();
          }
        } catch (e) {
          console.error("Warmup failed", e);
        }
      }
      
    let localCaptures: Capture[] = [];
    const captureVideoDiagnostics: Array<{
      captureIndex: number;
      status: "ok" | "missing";
      reason: string;
      blobSize: number;
      cameraType: string;
    }> = [];

    for (let i = 0; i < totalCaptures; i++) {
      console.log(`[Capture] Starting capture ${i + 1}/${totalCaptures}`);
      
      isRecordingRef.current = false;
      setIsRecording(false);
      setPhase("countdown");

      await new Promise<void>((resolve) => {
        let currentCount = cameraCountdown; 
        setCountdown(currentCount);

        const startRecordAt = Math.min(currentCount, 3); // เริ่มอัดเมื่อเหลือ 3 วิ

        if (currentCount <= startRecordAt && !isRecordingRef.current) {
          startRecording();
        }

        const timer = setInterval(() => {
          currentCount--;
          setCountdown(currentCount);

          if (currentCount <= startRecordAt && !isRecordingRef.current) {
            startRecording();
          }

          if (currentCount <= 0) {
            clearInterval(timer);
            resolve();
          }
        }, 1000);
      });

      // 🚨 สั่งหยุดวิดีโอ
      const recordingPromise = waitForVideo();

      // 👇👇👇 🚨 จุดเปลี่ยนสำคัญ: เว้นระยะให้ CPU หายใจ 100ms เพื่อแพ็คไฟล์เฟรมสุดท้ายให้เสร็จสมบูรณ์ ก่อนกล้องจะดึงพลังไปถ่ายรูป
      await new Promise((r) => setTimeout(r, 100));
      // 👆👆👆

      // 🚨 สั่งถ่ายภาพ
      const capturePromise = cameraTypeRef.current === "canon"
        ? canonCamera.takePicture()
        : takePhoto();

      // 🚨 ลดดีเลย์แฟลชลงมาเป็น 500 (เพื่อชดเชยที่เบรก CPU ไป 100ms ด้านบน)
      const flashDelay = cameraTypeRef.current === "canon" ? 500 : 0;
      setTimeout(() => {
        setShowFlash(true);
        setPhase("preview"); 
        setTimeout(() => setShowFlash(false), 300);
      }, flashDelay); 

      await new Promise((r) => setTimeout(r, 300)); 

      let photoData: string = "";
      try {
        photoData = await capturePromise;
      } catch (err) {
        // fallback
      }

      const recordingResult = await recordingPromise;
      let videoUrl = recordingResult.url;
      let videoPath = "";
      
      let blobSize = recordingResult.blob?.size ?? 0;
      let missingReason = "";

      const FORCE_TEST_MISSING_VIDEO = false; 
      const isTargetBrokenIndex = i === 1 || i === (totalCaptures - 1);

      if (FORCE_TEST_MISSING_VIDEO && isTargetBrokenIndex) {
        console.warn(`[TEST MODE] 💥 กำลังจำลองการทำลายวิดีโอ ช็อตที่ ${i + 1}`);
        missingReason = "TEST_MODE_FORCED_MISSING";
        videoPath = ""; 
      } 
      else {
        if (!recordingResult.blob) {
          missingReason = "recording_blob_null";
        } else if (blobSize <= 1000) {
          missingReason = `recording_blob_too_small_${blobSize}`;
        } else {
          videoPath = await saveVideoToTemp(recordingResult.blob, i);
          if (!videoPath) {
            missingReason = "save_temp_video_failed";
          }
        }
      }

      captureVideoDiagnostics.push({
        captureIndex: i,
        status: missingReason ? "missing" : "ok",
        reason: missingReason || "ok",
        blobSize,
        cameraType: cameraTypeRef.current,
      });

      const newCapture: Capture = { photo: photoData, video: videoUrl, videoPath };
      localCaptures.push(newCapture);
      setCaptures([...localCaptures]);
      setCurrentCapture(i + 1);
      
      // 🚨 เพิ่มเวลาพักตอนจบแต่ละลูปเป็น 300ms ให้ระบบเคลียร์แรม/คืน Memory ให้หมดจดก่อนลุยช็อตต่อไป
      await new Promise((r) => setTimeout(r, 300));
    }

    captureVideoDiagnosticsRef.current = captureVideoDiagnostics;
    const missingVideoDiagnostics = captureVideoDiagnostics.filter(
      (item) => item.status === "missing",
    );
    if (missingVideoDiagnostics.length > 0) {
      console.warn("[Capture Video Diagnostics]", {
        totalCaptures,
        missingCount: missingVideoDiagnostics.length,
        missingItems: missingVideoDiagnostics,
      });

      if (typeof logError === "function") {
        logError(
          "capture_video_missing",
          JSON.stringify({
            totalCaptures,
            missingCount: missingVideoDiagnostics.length,
            missingItems: missingVideoDiagnostics,
          }),
          undefined,
          "warning",
        );
      }
    }

    setPhase("done");
    sequenceRunningRef.current = false;

    setTimeout(() => {
      completeSession(localCaptures);
    }, 200);

  }, [
    totalCaptures,
    cameraCountdown,
    startRecording,
    waitForVideo,
    takePhoto,
    saveVideoToTemp,
    completeSession,
    navigate,
    state
  ]);

  useEffect(() => {
    if (cameraReady && !cameraError) {
      startShootingSequence();
    }
  }, [cameraReady, cameraError]);

  useEffect(() => {
    if (phase === "done") {
      const timer = setTimeout(() => {
        setVideosReadyTimeout(true);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  useEffect(() => {
    if (phase === "done" && captures.length >= totalCaptures) {
      const allVideosReady = captures.every(
        (c) => c.videoPath && c.videoPath.length > 0
      );

      if (allVideosReady || videosReadyTimeout) {
        const delay = setTimeout(() => {
          completeSession(captures);
        }, 100);
        return () => clearTimeout(delay);
      }
    }
  }, [phase, captures, totalCaptures, videosReadyTimeout, completeSession, navigate, state]);

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
        }
      }
    }, 2000);

    return () => clearInterval(checkCamera);
  }, [cameraType, navigate]);

  const getCurrentSlot = (): FrameSlot | null => {
    if (!slots.length) return null;
    const currentIndex = captures.length;
    if (currentIndex >= slots.length) return slots[slots.length - 1];
    return slots[currentIndex];
  };

  if (cameraError) {
    return (
      <div
        className="page-container"
        style={{ backgroundImage: `url(${theme.backgroundSecond})` }}
      >
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
      className="page-container page-space-between"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        height: "100vh",
        overflow: "hidden",
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <div className="page-main-content" style={{ marginTop: "60px" }}>
        <div className="page-row-top">
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              มองกล้อง!
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              LET'S TAKE A PHOTO
            </p>
          </div>
        </div>

        <div className="page-row-body">
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 24px",
            }}
          >
            <div
              ref={cameraContainerRef}
              style={{
                position: "relative",
                width: "100%",
                maxHeight: "60vh",
                borderRadius: 20,
                overflow: "hidden",
                boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                background: "rgba(0,0,0,0.2)",
                aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}`,
              }}
            >
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
                    transform: "scaleX(-1)", 
                    borderRadius: 20,
                  }}
                />
              )}

              {cameraType === "canon" && canonCamera.liveViewFrame && (
                <img
                  ref={canonLiveViewRef}
                  src={canonCamera.liveViewFrame}
                  alt="Canon Live View"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: "scaleX(-1)", 
                    borderRadius: 20,
                    filter: "blur(1px)",
                  }}
                />
              )}

              {cameraType === "canon" &&
                !canonCamera.liveViewFrame &&
                cameraReady && (
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

              {phase === "preview" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0,0,0,0.3)", 
                    zIndex: 25,
                    color: "white",
                  }}
                >
                  <div
                    className="loading-spinner"
                    style={{ width: 64, height: 64, borderWidth: 6, marginBottom: 16 }}
                  ></div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      textShadow: "0 4px 10px rgba(0,0,0,0.5)",
                    }}
                  >
                    กำลังบันทึกภาพ...
                  </div>
                </div>
              )}

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
        </div>

        <div className="page-row-footer" style={{ paddingBottom: "20px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              padding: "4px 8px",
              justifyContent: "center",
              width: "100%",
            }}
          >
            {Array.from({ length: totalCaptures }).map((_, idx) => {
              const slot =
                idx >= slots.length ? slots[slots.length - 1] : slots[idx];
              const maxDim = 100; 
              let tw = 0;
              let th = 0;
              if (slot) {
                if (slot.width >= slot.height) {
                  tw = maxDim;
                  th = (slot.height / slot.width) * maxDim;
                } else {
                  th = maxDim;
                  tw = (slot.width / slot.height) * maxDim;
                }
              } else {
                th = maxDim;
                tw = (3 / 4) * maxDim;
              }

              return (
                <div
                  key={idx}
                  style={{
                    width: tw,
                    height: th,
                    borderRadius: 8,
                    overflow: "hidden",
                    flexShrink: 0,
                    border: captures[idx]
                      ? "2px solid rgba(255,255,255,0.6)"
                      : "2px dashed rgba(255,255,255,0.2)",
                    background: captures[idx]
                      ? "transparent"
                      : "rgba(0,0,0,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {captures[idx] ? (
                    <img
                      src={captures[idx].photo}
                      alt={`Capture ${idx + 1}`}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontSize: 18,
                        fontWeight: 600,
                      }}
                    >
                      {idx + 1}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
      <canvas ref={canonCanvasRef} style={{ display: "none" }} />

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
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}