import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import RecordRTC from "recordrtc";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useCanon } from "../hooks/useCanon";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

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
}

export default function MainShooting({ theme, machineData, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const selectedFrame = state.selectedFrame;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  const cameraCountdown = Number(machineData.cameraCountdown) || 5;
  const totalSlots = slots.length || 4;
  const totalCaptures = totalSlots + 2; 

  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraContainerRef = useRef<HTMLDivElement>(null);
  const canonLiveViewRef = useRef<HTMLImageElement>(null);
  const mediaRecorderRef = useRef<RecordRTC | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const sequenceRunningRef = useRef(false);
  const cameraTypeRef = useRef("webcam");

  const pendingVideoFramesRef = useRef<{ index: number; frames: string[]; duration: number }[]>([]);

  const canonCamera = useCanon();

  const [captures, setCaptures] = useState<Capture[]>([]);
  const [, setCurrentCapture] = useState(0);
  const [countdown, setCountdown] = useState(-1);
  const [phase, setPhase] = useState<
    "ready" | "countdown" | "flash" | "preview" | "done" | "preparing"
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
    if (cameraTypeRef.current === "canon") {
      canonCamera.cleanup();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startRecording = useCallback(() => {
    if (!streamRef.current || isRecordingRef.current) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";

    const recorder = new RecordRTC(streamRef.current, {
      type: "video",
      mimeType: mimeType as any,
      videoBitsPerSecond: 15000000, 
      frameRate: 30,
      timeSlice: 1000, 
      disableLogs: true,
    });

    (window as any).__lastVideoReady = false;
    (window as any).__lastVideoUrl = "";
    (window as any).__lastVideoBlob = null;

    recorder.startRecording();
    mediaRecorderRef.current = recorder;
    isRecordingRef.current = true;
    setIsRecording(true);
  }, []);

  const waitForVideo = useCallback((): Promise<{
    url: string;
    blob: Blob | null;
  }> => {
    return new Promise((resolve) => {
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.getState() !== "inactive"
      ) {
        mediaRecorderRef.current.stopRecording(() => {
          const blob = mediaRecorderRef.current!.getBlob();
          const url = URL.createObjectURL(blob);
          isRecordingRef.current = false;
          setIsRecording(false);
          resolve({ url, blob });
        });
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

  const createVideoFromFrames = useCallback(
    async (
      frames: string[],
      targetDurationSec: number, 
    ): Promise<{ url: string; blob: Blob | null }> => {
      if (!frames || frames.length === 0) {
        return { url: "", blob: null };
      }

      const targetFps = 15;
      const targetFramesCount = 45; 
      
      let sampledFrames: string[] = [];
      if (frames.length > targetFramesCount) {
        const step = frames.length / targetFramesCount;
        for (let i = 0; i < targetFramesCount; i++) {
          sampledFrames.push(frames[Math.floor(i * step)]);
        }
      } else {
        sampledFrames = frames;
      }

      const loadedImages = await Promise.all(
        sampledFrames.map((src) => {
          return new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null); 
            img.src = src;
          });
        })
      );

      return new Promise((resolve) => {
        const offCanvas = document.createElement("canvas");
        offCanvas.width = 960; 
        offCanvas.height = 640;
        
        offCanvas.style.position = "fixed";
        offCanvas.style.top = "0px";
        offCanvas.style.left = "0px";
        offCanvas.style.opacity = "0.01";
        offCanvas.style.pointerEvents = "none";
        offCanvas.style.zIndex = "-9999";
        document.body.appendChild(offCanvas);

        const ctx = offCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
        if (!ctx) {
          if (offCanvas.parentNode) document.body.removeChild(offCanvas);
          return resolve({ url: "", blob: null });
        }

        const firstValid = loadedImages.find(img => img !== null);
        if (firstValid) {
          ctx.drawImage(firstValid, 0, 0, offCanvas.width, offCanvas.height);
        }

        const finalFps = Math.max(5, Math.min(targetFps, sampledFrames.length / targetDurationSec));
        const stream = offCanvas.captureStream(finalFps);
        const mimeType = "video/webm;codecs=vp8"; 
          
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 2500000,
        });
        
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          if (offCanvas.parentNode) document.body.removeChild(offCanvas);
          const blob = new Blob(chunks, { type: mimeType });
          
          if (blob.size < 1000) {
             console.warn("[createVideo] Blob is corrupted (too small), generation failed");
             resolve({ url: "", blob: null });
             return;
          }
          
          const url = URL.createObjectURL(blob);
          resolve({ url, blob });
        };

        recorder.start();

        let frameIdx = 0;
        const interval = setInterval(() => {
          if (frameIdx >= loadedImages.length) {
            clearInterval(interval);
            setTimeout(() => {
              if (recorder.state !== "inactive") recorder.stop();
            }, 300);
            return;
          }

          const img = loadedImages[frameIdx];
          if (img) {
            ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height);
            const track = stream.getVideoTracks()[0];
            if (track && typeof (track as any).requestFrame === "function") {
                (track as any).requestFrame();
            }
          }
          frameIdx++;
        }, 1000 / finalFps);
      });
    },
    []
  );

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

    pendingVideoFramesRef.current = [];
    let localCaptures: Capture[] = []; 

    for (let i = 0; i < totalCaptures; i++) {
      console.log(`[Capture] Starting capture ${i + 1}/${totalCaptures}`);
      
      isRecordingRef.current = false;
      setIsRecording(false);

      setPhase("countdown");

      await new Promise<void>((resolve) => {
        let currentCount = cameraCountdown; 
        setCountdown(currentCount);

        const webcamStartAt = Math.min(currentCount, 3);
        const canonStartAt = Math.min(currentCount, 4);

        if (cameraTypeRef.current === "canon" && currentCount <= canonStartAt && !isRecordingRef.current) {
          canonCamera.startFrameRecording();
          isRecordingRef.current = true;
          setIsRecording(true);
          (window as any).__recordStartTime = Date.now();
          (window as any).__canonMovieFallback = true;
          if (currentCount <= 3) {
             (window as any).__countdown3Time = Date.now();
          }
        } else if (cameraTypeRef.current !== "canon" && currentCount <= webcamStartAt && !isRecordingRef.current) {
          startRecording();
        }

        const timer = setInterval(() => {
          currentCount--;
          setCountdown(currentCount);

          if (currentCount === 3) {
             (window as any).__countdown3Time = Date.now();
          }

          if (cameraTypeRef.current === "canon") {
            if (currentCount <= canonStartAt && !isRecordingRef.current) {
              canonCamera.startFrameRecording();
              isRecordingRef.current = true;
              setIsRecording(true);
              (window as any).__recordStartTime = Date.now();
              (window as any).__canonMovieFallback = true;
              if (currentCount === 3) {
                 (window as any).__countdown3Time = Date.now();
              }
            }
          } else {
            if (currentCount <= webcamStartAt && !isRecordingRef.current) {
              startRecording();
            }
          }

          if (currentCount <= 0) {
            clearInterval(timer);
            resolve();
          }
        }, 1000);
      });

      let recordingResult: { url: string; blob: Blob | null } = {
        url: "",
        blob: null,
      };

      if (cameraTypeRef.current === "canon") {
        if ((window as any).__canonMovieFallback) {
          const recording = canonCamera.stopFrameRecording();
          isRecordingRef.current = false;
          setIsRecording(false);
          
          const rawFrames = recording.frames || [];
          
          const stopTime = Date.now();
          const recordStartTime = (window as any).__recordStartTime || stopTime;
          let countdown3Time = (window as any).__countdown3Time || recordStartTime;

          if (cameraCountdown > 3) {
              countdown3Time += 250;
          }

          const totalDurationMs = stopTime - recordStartTime;
          let keepDurationMs = stopTime - countdown3Time;
          
          if (keepDurationMs <= 0 || keepDurationMs > totalDurationMs) {
              keepDurationMs = totalDurationMs;
          }

          let keepRatio = keepDurationMs / totalDurationMs;
          if (keepRatio > 1) keepRatio = 1; 

          const framesToKeep = Math.floor(rawFrames.length * keepRatio);
          const last3SecFrames = rawFrames.slice(-framesToKeep);

          const targetFramesCount = 45;
          let final45Frames: string[] = [];
          if (last3SecFrames.length > 0) {
              const step = last3SecFrames.length / targetFramesCount;
              for (let j = 0; j < targetFramesCount; j++) {
                  final45Frames.push(last3SecFrames[Math.floor(j * step)]);
              }
          }
          
          (window as any).__lastCanonFrames = final45Frames;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        recordingResult = await waitForVideo();
      }

      setShowFlash(true);
      setPhase("preview"); 
      
      setTimeout(() => {
        setShowFlash(false);
      }, 300);

      let photoData: string = "";
      try {
        if (cameraTypeRef.current === "canon" && !(window as any).__canonMovieFallback) {
          photoData = await canonCamera.takePhotoDuringRecording();
        } else {
          photoData = await takePhoto();
        }
      } catch (err) {
        console.warn("[Capture] Auto Focus Fail or Error, Retrying...", err);
        await new Promise((r) => setTimeout(r, 600));
        try {
          photoData = await takePhoto();
        } catch (retryErr) {
          console.error("[Capture] Retry failed", retryErr);
        }
      }

      if (!photoData || photoData.length < 100) {
        console.warn("[Capture] AF Failed! Fallback to LiveView screen capture.");
        if (cameraTypeRef.current === "canon" && canonCamera.liveViewFrame) {
          photoData = canonCamera.liveViewFrame;
        } else if (cameraTypeRef.current === "webcam" && videoRef.current && canvasRef.current) {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          canvas.width = video.videoWidth || 1920;
          canvas.height = video.videoHeight || 1080;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            photoData = canvas.toDataURL("image/jpeg", 0.92);
          }
        }
      }

      const captureIndex = i;

      if (cameraTypeRef.current === "canon") {
        const frames = ((window as any).__lastCanonFrames as string[]) || [];
        (window as any).__lastCanonFrames = null;

        if (frames.length > 0) {
          pendingVideoFramesRef.current.push({ index: captureIndex, frames, duration: 3.0 });
        }

        const newCapture: Capture = { photo: photoData, video: "", videoPath: "" };
        localCaptures.push(newCapture);
        setCaptures([...localCaptures]);
        setCurrentCapture(i + 1);

        // 🚀 ปรับเป็น 400ms ให้จังหวะรอยต่อสมูทขึ้น ตัวเลขไม่กระตุก!
        await new Promise((r) => setTimeout(r, 400));

      } else {
        let videoUrl = recordingResult.url;
        let videoPath = "";
        
        if (recordingResult.blob && recordingResult.blob.size > 1000) {
          videoPath = await saveVideoToTemp(recordingResult.blob, i);
          
          if (cameraCountdown > 3) {
              try {
                  const trimmedPath: string = await invoke("trim_video_keep_last", {
                      inputPath: videoPath,
                      keepSeconds: 3,
                      outputFilename: `trimmed_webcam_${captureIndex}.mp4`, 
                  });
                  if (trimmedPath) {
                      videoPath = trimmedPath;
                  }
              } catch (err) {
                  console.error("[Webcam] Trim error:", err);
              }
          }
        }

        const newCapture: Capture = { photo: photoData, video: videoUrl, videoPath: videoPath };
        localCaptures.push(newCapture);
        setCaptures([...localCaptures]);
        setCurrentCapture(i + 1);
        
        // 🚀 ปรับเป็น 400ms เช่นเดียวกัน
        await new Promise((r) => setTimeout(r, 400));
      }

      console.log(`[Capture] Capture ${i + 1}/${totalCaptures} completed`);

      if (i + 1 >= totalCaptures) {
        break;
      }
    }

    if (pendingVideoFramesRef.current.length > 0) {
      console.log(`[MainShooting] Post-processing ${pendingVideoFramesRef.current.length} Canon videos...`);
      setPhase("preparing"); 
      
      await Promise.all(
        pendingVideoFramesRef.current.map(async (item) => {
          try {
            const result = await createVideoFromFrames(item.frames, 3.0);
            if (result.blob && result.blob.size > 1000) {
              let path = await saveVideoToTemp(result.blob, item.index);
              localCaptures[item.index].video = result.url;
              localCaptures[item.index].videoPath = path;
            } else {
               console.warn(`[Canon] Blob is corrupted for capture ${item.index + 1}`);
            }
          } catch (err) {
            console.error(`[Canon] Background video processing failed for capture ${item.index + 1}:`, err);
          }
        })
      );
      
      pendingVideoFramesRef.current = []; 
      setCaptures([...localCaptures]); 
    }

    setPhase("done");
    sequenceRunningRef.current = false;

    setTimeout(() => {
      navigate("/slot-selection", {
        state: {
          ...state,
          captures: localCaptures,
        },
      });
    }, 500);

  }, [
    totalCaptures,
    cameraCountdown,
    startRecording,
    waitForVideo,
    takePhoto,
    saveVideoToTemp,
    createVideoFromFrames,
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
      const isCanonMovie =
        cameraTypeRef.current === "canon" &&
        !(window as any).__canonMovieFallback;

      const allVideosReady = captures.every(
        (c) => c.videoPath && c.videoPath.length > 0
      );

      if (!isCanonMovie || allVideosReady || videosReadyTimeout) {
        const delay = setTimeout(() => {
          navigate("/slot-selection", {
            state: {
              ...state,
              captures,
            },
          });
        }, 200);
        return () => clearTimeout(delay);
      }
    }
  }, [phase, captures, totalCaptures, videosReadyTimeout, navigate, state]);

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

              {phase === "preparing" && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(0,0,0,0.7)",
                    zIndex: 40,
                    color: "white",
                  }}
                >
                  <div
                    className="loading-spinner"
                    style={{ marginBottom: 20 }}
                  ></div>
                  <div style={{ fontSize: 24, fontWeight: 600 }}>
                    กำลังประมวลผลวิดีโอ...
                  </div>
                  <div style={{ fontSize: 16, marginTop: 8, opacity: 0.8 }}>
                    Processing Videos
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