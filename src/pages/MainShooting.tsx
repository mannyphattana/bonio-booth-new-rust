import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useCanon } from "../hooks/useCanon";

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
  let displayW = containerWidth, displayH = containerHeight;
  const containerRatio = containerWidth / containerHeight;
  if (videoRatio > containerRatio) { displayH = containerHeight; displayW = containerHeight * videoRatio; } else { displayW = containerWidth; displayH = containerWidth / videoRatio; }
  let cropW: number, cropH: number;
  if (slotRatio > videoRatio) { cropW = displayW; cropH = displayW / slotRatio; } else { cropH = displayH; cropW = displayH * slotRatio; }
  const visibleCropX = Math.max(0, (containerWidth - cropW) / 2);
  const visibleCropY = Math.max(0, (containerHeight - cropH) / 2);
  const visibleCropW = Math.min(cropW, containerWidth);
  const visibleCropH = Math.min(cropH, containerHeight);
  return (
    <svg style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10 }}>
      <rect x={visibleCropX} y={visibleCropY} width={visibleCropW} height={visibleCropH} fill="none" stroke="rgba(255, 255, 255, 0.8)" strokeWidth="2" strokeDasharray="10,5" />
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

  // --- 1. Logic คำนวณจำนวนรูป (ตามสูตรที่คุณต้องการ) ---
  let totalCaptures = totalSlots + 2; // ค่า Default (เผื่อ 2)
  if (totalSlots === 4) {
    totalCaptures = 4; // 4 ช่อง ถ่าย 4 รูป
  } else if (totalSlots === 6) {
    totalCaptures = 8; // 6 ช่อง ถ่าย 8 รูป
  }
  // --------------------------------------------------

  // --- 2. Logic คำนวณขนาดรูป (แนวนอนต้องใหญ่หน่อย) ---
  const firstSlot = slots[0] || { width: 3, height: 4 };
  const isHorizontal = firstSlot.width > firstSlot.height;
  
  const thumbWidthVal = isHorizontal ? 140 : 100; // แนวนอน 140px, แนวตั้ง 100px
  const thumbGap = 16;
  const containerMaxWidthVal = (thumbWidthVal * 3) + (thumbGap * 2) + 20; // คำนวณความกว้าง Container ให้พอดี 3 รูป
  // --------------------------------------------------

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

  useEffect(() => { initCamera(); return () => { stopCamera(); }; }, []);

  const initCamera = async () => {
    try {
      const type: string = await invoke("get_camera_type");
      setCameraType(type); cameraTypeRef.current = type;
      if (type === "webcam") { await initWebcam(); } else { await initCanon(); }
    } catch (err: any) { setCameraError("Camera not found. Please check connection."); console.error("Camera init error:", err); }
  };

  const initCanon = async () => {
    const sdkOk = await canonCamera.initialize();
    if (!sdkOk) { setCameraError("Canon SDK initialization failed"); return; }
    const connOk = await canonCamera.connect(0);
    if (!connOk) { setCameraError("Cannot connect to Canon camera"); return; }
    await new Promise((r) => setTimeout(r, 300));
    let lvOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) { lvOk = await canonCamera.startLiveView(); if (lvOk) break; await new Promise((r) => setTimeout(r, attempt * 500)); }
    if (!lvOk) { await canonCamera.cleanup(); setCameraError("Cannot start Canon live view"); return; }
    let waitTime = 0;
    while (!canonCamera.liveViewFrame && waitTime < 3000) { await new Promise((r) => setTimeout(r, 100)); waitTime += 100; }
    setVideoDimensions({ width: 1920, height: 1280 }); setCameraReady(true);
    setTimeout(() => { if (cameraContainerRef.current) { const rect = cameraContainerRef.current.getBoundingClientRect(); setContainerDimensions({ width: rect.width, height: rect.height }); } }, 100);
  };

  const initWebcam = async () => {
    stopCamera();
    const constraints = [{ video: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } }, audio: false }, { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: false }, { video: true, audio: false }];
    let lastErr: any;
    for (const constraint of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraint); streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await new Promise<void>((resolve) => { videoRef.current!.onloadedmetadata = () => { const vw = videoRef.current!.videoWidth; const vh = videoRef.current!.videoHeight; if (vw > 0 && vh > 0) { setVideoDimensions({ width: vw, height: vh }); } resolve(); }; }); await videoRef.current.play(); }
        setCameraReady(true); setTimeout(() => { if (cameraContainerRef.current) { const rect = cameraContainerRef.current.getBoundingClientRect(); setContainerDimensions({ width: rect.width, height: rect.height }); } }, 100); return;
      } catch (err: any) { lastErr = err; if (err.name === "NotReadableError") { await new Promise((r) => setTimeout(r, 1000)); } }
    }
    setCameraError("ไม่พบกล้อง กรุณาตรวจสอบการเชื่อมต่อ"); throw lastErr;
  };

  const stopCamera = () => { if (cameraTypeRef.current === "canon") { canonCamera.cleanup(); } if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; } };

  const startRecording = useCallback(() => {
    if (cameraTypeRef.current === "canon") { canonCamera.startFrameRecording(); setIsRecording(true); return; }
    if (!streamRef.current || isRecordingRef.current) return;
    const chunks: Blob[] = []; const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const recorder = new MediaRecorder(streamRef.current, { mimeType, videoBitsPerSecond: 15000000 });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => { const blob = new Blob(chunks, { type: mimeType }); const url = URL.createObjectURL(blob); (window as any).__lastVideoUrl = url; (window as any).__lastVideoBlob = blob; (window as any).__lastVideoReady = true; };
    (window as any).__lastVideoReady = false; (window as any).__lastVideoUrl = ""; (window as any).__lastVideoBlob = null;
    recorder.start(); mediaRecorderRef.current = recorder; isRecordingRef.current = true; setIsRecording(true);
  }, []);

  const waitForVideo = useCallback((): Promise<{ url: string; blob: Blob | null }> => {
    if (cameraTypeRef.current === "canon") { const recording = canonCamera.stopFrameRecording(); isRecordingRef.current = false; setIsRecording(false); if (recording.frames.length > 0) { return createVideoFromFrames(recording.frames, 30).then((result) => result); } return Promise.resolve({ url: "", blob: null }); }
    return new Promise((resolve) => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") { mediaRecorderRef.current.stop(); }
      isRecordingRef.current = false; setIsRecording(false);
      const check = setInterval(() => { if ((window as any).__lastVideoReady) { clearInterval(check); resolve({ url: (window as any).__lastVideoUrl || "", blob: (window as any).__lastVideoBlob || null }); } }, 50);
      setTimeout(() => { clearInterval(check); resolve({ url: (window as any).__lastVideoUrl || "", blob: (window as any).__lastVideoBlob || null }); }, 3000);
    });
  }, []);

  const takePhoto = useCallback(async (): Promise<string> => {
    if (cameraTypeRef.current === "canon") { return await canonCamera.takePicture(); }
    if (!videoRef.current || !canvasRef.current) return "";
    const video = videoRef.current; const canvas = canvasRef.current; const maxDim = 1920;
    let w = video.videoWidth; let h = video.videoHeight;
    if (w > maxDim || h > maxDim) { const ratio = Math.min(maxDim / w, maxDim / h); w = Math.round(w * ratio); h = Math.round(h * ratio); }
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) return ""; ctx.drawImage(video, 0, 0, w, h); return canvas.toDataURL("image/jpeg", 0.92);
  }, []);

  const createVideoFromFrames = useCallback(async (frames: string[], fps: number): Promise<{ url: string; blob: Blob | null }> => {
    if (frames.length === 0) return { url: "", blob: null };
    const cappedFps = Math.min(fps, 30);
    return new Promise((resolve) => {
      const offCanvas = document.createElement("canvas"); offCanvas.width = 1920; offCanvas.height = 1280;
      const ctx = offCanvas.getContext("2d", { alpha: false, colorSpace: "srgb" }); if (!ctx) { resolve({ url: "", blob: null }); return; }
      const stream = offCanvas.captureStream(cappedFps); const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 }); const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => { const blob = new Blob(chunks, { type: mimeType }); const url = URL.createObjectURL(blob); resolve({ url, blob }); };
      recorder.start(); let frameIdx = 0;
      const interval = setInterval(() => { if (frameIdx >= frames.length) { clearInterval(interval); recorder.stop(); return; } const img = new Image(); img.onload = () => { ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height); }; img.src = frames[frameIdx]; frameIdx++; }, 1000 / cappedFps);
    });
  }, []);

  const saveVideoToTemp = useCallback(async (blob: Blob, index: number): Promise<string> => {
    try { const arrayBuffer = await blob.arrayBuffer(); const uint8Array = new Uint8Array(arrayBuffer); const base64 = btoa(uint8Array.reduce((data, byte) => data + String.fromCharCode(byte), "")); return await invoke("save_temp_video", { videoDataBase64: base64, filename: `capture_${index}.webm` }); } catch (err) { console.error("Failed to save video to temp:", err); return ""; }
  }, []);

  const startShootingSequence = useCallback(async () => {
    if (sequenceRunningRef.current) return; sequenceRunningRef.current = true;
    if (cameraTypeRef.current === "canon") {
      const FRESH_FRAME_TIMEOUT = 5000; const POLL_MS = 50; let elapsed = 0; let lastFingerprint = ""; let freshCount = 0; const REQUIRED_FRESH = 2; setShowGetReady(true);
      while (elapsed < FRESH_FRAME_TIMEOUT && freshCount < REQUIRED_FRESH) { const frame = canonCamera.getLatestFrame(); if (frame) { const fp = `${frame.length}:${frame.slice(-100)}`; if (fp !== lastFingerprint) { freshCount++; lastFingerprint = fp; } } await new Promise((r) => setTimeout(r, POLL_MS)); elapsed += POLL_MS; } setShowGetReady(false);
    } else { setShowGetReady(true); await new Promise((r) => setTimeout(r, 1500)); setShowGetReady(false); }
    for (let i = 0; i < totalCaptures; i++) {
      setPhase("countdown"); const recordStartAt = Math.min(cameraCountdown, 3);
      await new Promise<void>((resolve) => { let currentCount = cameraCountdown; setCountdown(currentCount); if (cameraCountdown <= 3) { startRecording(); } const timer = setInterval(() => { currentCount--; setCountdown(currentCount); if (currentCount === recordStartAt && cameraCountdown > 3 && !isRecordingRef.current) { startRecording(); } if (currentCount <= 0) { clearInterval(timer); resolve(); } }, 1000); });
      let recordingResult: { url: string; blob: Blob | null } = { url: "", blob: null };
      if (cameraTypeRef.current === "canon") { const recording = canonCamera.stopFrameRecording(); isRecordingRef.current = false; setIsRecording(false); (window as any).__lastCanonFrames = recording.frames; } else { recordingResult = await waitForVideo(); }
      const photoData = await takePhoto(); setShowFlash(true); setPhase("flash"); await new Promise((r) => setTimeout(r, 300)); setShowFlash(false);
      let videoUrl = ""; let videoPath = "";
      if (cameraTypeRef.current === "canon") { const frames = (window as any).__lastCanonFrames as string[] || []; if (frames.length > 0) { const captureIndex = i; createVideoFromFrames(frames, 30).then(async (result) => { if (result.blob) { const path = await saveVideoToTemp(result.blob, captureIndex); setCaptures((prev) => { const updated = [...prev]; if (updated[captureIndex]) { updated[captureIndex] = { ...updated[captureIndex], video: result.url, videoPath: path }; } return updated; }); } }).catch((err) => { console.error(`[Canon] Background video processing failed:`, err); }); } (window as any).__lastCanonFrames = null; } else { videoUrl = recordingResult.url; if (recordingResult.blob) { videoPath = await saveVideoToTemp(recordingResult.blob, i); } }
      const newCapture: Capture = { photo: photoData, video: videoUrl, videoPath: videoPath }; setCaptures((prev) => [...prev, newCapture]); setCurrentCapture(i + 1); setPhase("preview");
      if (i + 1 >= totalCaptures) { setPhase("done"); sequenceRunningRef.current = false; break; } await new Promise((r) => setTimeout(r, 1500));
    }
  }, [totalCaptures, cameraCountdown, startRecording, waitForVideo, takePhoto, saveVideoToTemp, createVideoFromFrames]);

  useEffect(() => { if (cameraReady && !cameraError) { startShootingSequence(); } }, [cameraReady, cameraError]);
  useEffect(() => { if (phase === "done" && captures.length >= totalCaptures) { setTimeout(() => { navigate("/slot-selection", { state: { ...state, captures } }); }, 1500); } }, [phase, captures, totalCaptures]);
  useEffect(() => { const checkCamera = setInterval(async () => { if (cameraType === "webcam" && streamRef.current) { const videoTrack = streamRef.current.getVideoTracks()[0]; if (!videoTrack || videoTrack.readyState === "ended") { setCameraError("กล้องถูกถอดออก กรุณาเชื่อมต่อใหม่"); setTimeout(() => navigate("/"), 3000); } } else if (cameraType === "canon") { try { const connected = await invoke<boolean>("canon_is_connected"); if (!connected) { setCameraError("กล้อง Canon ถูกถอดออก กรุณาเชื่อมต่อใหม่"); setTimeout(() => navigate("/"), 3000); } } catch {} } }, 2000); return () => clearInterval(checkCamera); }, [cameraType, navigate]);

  if (cameraError) { return (<div className="page-container" style={{ backgroundImage: `url(${theme.backgroundSecond})` }}><div className="error-modal-overlay"><div className="error-modal"><h2>⚠️ Camera Error</h2><p>{cameraError}</p><button onClick={() => navigate("/")}>กลับหน้าหลัก</button></div></div></div>); }
  const currentSlot = slots.length ? (captures.length >= slots.length ? slots[0] : slots[captures.length]) : null;

  return (
    <div className="page-container page-space-between" style={{ backgroundImage: `url(${theme.backgroundSecond})`, height: "100vh", overflow: "hidden" }}>
      {/* 1. Header */}
      <div style={{ position: "absolute", top: "20px", left: 0, width: "100%", padding: "0 20px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", zIndex: 100, pointerEvents: "none" }}>
        <div style={{ transform: "rotate(-90deg) translate(-20px, 0)", transformOrigin: "top left", marginTop: "40px" }}>
           <span style={{ fontSize: "24px", fontWeight: "bold", color: "#e94560", fontFamily: "sans-serif", letterSpacing: "1px" }}>timelab<span style={{ fontSize: "12px", color: "#e94560", marginLeft: "4px", writingMode: "vertical-rl", textOrientation: "mixed" }}>PHOTO BOOTH</span></span>
        </div>
        <div style={{ fontSize: "30px", color: "white", opacity: 0.8, marginTop: "10px", marginRight: "10px" }}>✨</div>
      </div>

      {/* 2. Title */}
      <div style={{ width: "100%", textAlign: "center", marginTop: "40px", zIndex: 10, flexShrink: 0 }}>
        <h1 style={{ color: "#e94560", fontSize: "42px", fontWeight: "bold", margin: 0, lineHeight: 1 }}>มองกล้อง!</h1>
        <p style={{ color: "#e94560", letterSpacing: "1px", opacity: 0.8, fontSize: "14px", marginTop: "5px", textTransform: "uppercase" }}>LET'S TAKE A PHOTO</p>
      </div>

      {/* 3. Camera View */}
      <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 0", minHeight: 0 }}>
        <div ref={cameraContainerRef} style={{ position: "relative", width: "85%", maxHeight: "50vh", borderRadius: 20, overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,0.3)", background: "black", aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}` }}>
          {cameraType === "webcam" && (<video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />)}
          {cameraType === "canon" && canonCamera.liveViewFrame && (<img ref={canonLiveViewRef} src={canonCamera.liveViewFrame} alt="Live View" style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />)}
          {currentSlot && cameraReady && (<CropOverlay slotWidth={currentSlot.width} slotHeight={currentSlot.height} videoWidth={videoDimensions.width} videoHeight={videoDimensions.height} containerWidth={containerDimensions.width} containerHeight={containerDimensions.height} />)}
          {phase === "countdown" && countdown > 0 && (<div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20 }}><div style={{ fontSize: 150, fontWeight: 900, color: "white", textShadow: "0 4px 20px rgba(0,0,0,0.5)", animation: "countdownPulse 1s infinite" }}>{countdown}</div></div>)}
          {showGetReady && (<div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", zIndex: 25 }}><div style={{ fontSize: 40, fontWeight: 800, color: "white", marginBottom: 10 }}>Get</div><div style={{ fontSize: 40, fontWeight: 800, color: "white" }}>ready...</div></div>)}
          {showFlash && (<div style={{ position: "absolute", inset: 0, background: "white", animation: "flashAnim 0.3s forwards", zIndex: 30 }} />)}
        </div>
      </div>

      {/* 4. Thumbnails Grid (ใช้สูตรเดิมวน loop แต่ใส่ Style ใหม่) */}
      <div 
        style={{ 
          width: "100%", 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center",
          flexShrink: 0,
          zIndex: 20,
          paddingBottom: "60px",
          paddingTop: "10px"
        }}
      >
        <div style={{ 
           display: "flex",
           flexWrap: "wrap", 
           justifyContent: "center", 
           gap: `${thumbGap}px`,
           maxWidth: `${containerMaxWidthVal}px`,
        }}>
          {Array.from({ length: totalCaptures }).map((_, idx) => {
            const slot = slots[0];
            const ratio = slot ? `${slot.width} / ${slot.height}` : "3 / 4";

            return (
              <div
                key={idx}
                style={{
                  width: `${thumbWidthVal}px`, // ใช้ความกว้างที่คำนวณไว้ (แนวนอน 140, แนวตั้ง 100)
                  aspectRatio: ratio, 
                  borderRadius: "12px", 
                  backgroundColor: "white",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
                  border: "none"
                }}
              >
                {captures[idx] ? (
                  <img src={captures[idx].photo} alt="captured" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ color: "#eee", fontWeight: "bold", fontSize: "36px" }}>{idx + 1}</span> 
                )}
              </div>
            );
          })}
        </div>
        
        {/* Logo */}
        <div style={{ position: "absolute", bottom: "30px", right: "40px", opacity: 0.8 }}>
           <span style={{ fontSize: "24px", fontWeight: "bold", color: "#fff" }}>timelab</span>
           <span style={{ fontSize: "10px", display: "block", textAlign: "right", color: "#fff" }}>PHOTO BOOTH</span>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: "none" }} />
      <style>{`
        @keyframes countdownPulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.2); opacity: 0.8; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes flashAnim { 0% { opacity: 1; } 100% { opacity: 0; } }
      `}</style>
    </div>
  );
}