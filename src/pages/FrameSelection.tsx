import React, { useState, useEffect, useRef } from "react";
import { appLogger } from "../utils/appLogger";
import { logError } from "../utils/logger";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, FrameData } from "../App";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";
import LocalImage from "../components/LocalImage";

const CTX = "[FrameSelection]";

/** data ของ get_frames / get_cached_frames เป็นได้ทั้ง array และ { frames: [...] } */
function toFrameList(data: any): FrameData[] {
  return Array.isArray(data) ? data : data?.frames || [];
}

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function FrameSelection({ theme, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [selectedFrame, setSelectedFrame] = useState<FrameData | null>(null);
  const [loading, setLoading] = useState(true);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftPos, setScrollLeftPos] = useState(0);
  const dragDistanceRef = useRef(0);

  const scrollLeft = () =>
    scrollContainerRef.current?.scrollBy({ left: -280, behavior: "smooth" });
  const scrollRight = () =>
    scrollContainerRef.current?.scrollBy({ left: 280, behavior: "smooth" });

  const onMouseDown = (e: React.MouseEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
    setScrollLeftPos(scrollContainerRef.current.scrollLeft);
    dragDistanceRef.current = 0;
  };
  const onMouseLeave = () => setIsDragging(false);
  const onMouseUp = () => setIsDragging(false);
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollContainerRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    scrollContainerRef.current.scrollLeft = scrollLeftPos - walk;
    dragDistanceRef.current = Math.abs(x - startX);
  };
  const handleFrameClick = (frame: FrameData) => {
    if (dragDistanceRef.current > 5) return;
    setSelectedFrame(frame);
  };

  /// อุ่น cache รูปกรอบไว้ตั้งแต่ตอนนี้ — ห่างจากตอน compose เป็นนาที (ยังต้องถ่ายอีก 4-6 ใบ)
  /// ถ้าเน็ตสะดุดตอน compose จะได้ไม่เสียงานที่ลูกค้าจ่ายเงินไปแล้ว
  /// พังก็ปล่อยผ่าน ไม่บล็อก UI และไม่ขึ้น error ให้ลูกค้าเห็น
  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const url = selectedFrame?.imageUrl;
    if (!url || prefetchedRef.current.has(url)) return;
    prefetchedRef.current.add(url);
    invoke("prefetch_frame_image", { frameImageUrl: url })
      .then((bytes) => appLogger.info(CTX, `Frame prefetched (${bytes} bytes)`))
      .catch((err) =>
        appLogger.warn(CTX, `Frame prefetch failed (ไม่กระทบ flow): ${err}`)
      );
  }, [selectedFrame?.imageUrl]);

  const [loadFailed, setLoadFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    loadFrames();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyFrames = (list: FrameData[]) => {
    setFrames(list);
    // รายการใหม่จาก backend มาถึงระหว่างลูกค้าเลือกอยู่ — คงกรอบที่เลือกไว้ถ้ายังมี
    setSelectedFrame((prev) => list.find((f) => f._id === prev?._id) ?? list[0] ?? null);
  };

  /**
   * ใช้รายการกรอบที่เก็บในเครื่องก่อน แล้วค่อยดึงของใหม่จาก backend มาอัปเดต
   *
   * เคส 2026-10-31 ตู้ BACCARAT: เดิมดึงจาก backend อย่างเดียวครั้งเดียว เน็ตหลุดตอนนั้น
   * หน้านี้ว่างเปล่า ลูกค้าที่จ่ายเงินแล้วไปต่อไม่ได้จนหมดเวลา
   */
  const loadFrames = async () => {
    setLoadFailed(false);
    let hasLocal = false;
    try {
      const cached: any = await invoke("get_cached_frames");
      const list = toFrameList(cached);
      if (list.length > 0 && mountedRef.current) {
        applyFrames(list);
        hasLocal = true;
        setLoading(false);
      }
    } catch (err) {
      appLogger.warn(CTX, `get_cached_frames failed: ${err}`);
    }

    // มีในเครื่องแล้ว = ดึงครั้งเดียวเบื้องหลังพอ, ยังไม่มีเลย = ลูกค้ารออยู่ ลองซ้ำ
    const retryDelaysMs = hasLocal ? [] : [2000, 4000];
    let lastError = "";
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      try {
        const result: any = await invoke("get_frames");
        if (result.success && result.data) {
          if (mountedRef.current) applyFrames(toFrameList(result.data));
          lastError = "";
          break;
        }
        lastError = result.error || "get_frames returned no data";
      } catch (err) {
        lastError = String(err);
      }
      appLogger.warn(CTX, `Load frames attempt ${attempt + 1} failed: ${lastError}`);
      if (attempt < retryDelaysMs.length) {
        await new Promise((r) => setTimeout(r, retryDelaysMs[attempt]));
      }
    }

    if (lastError && !hasLocal) {
      appLogger.error(CTX, "Load frames error:", lastError);
      logError(
        "frames_load_failed",
        `No frames on this machine and get_frames failed${state?.referenceId ? ` (txCode: ${state.referenceId})` : ""}: ${lastError}`,
        undefined,
        "error",
      );
      if (mountedRef.current) setLoadFailed(true);
    }
    if (mountedRef.current) setLoading(false);
  };

  const handleCountdownComplete = async () => {
    const msg = `Countdown expired on FrameSelection${state?.referenceId ? `, txCode: ${state.referenceId}` : ''}`;
    appLogger.warn(CTX, msg);
    logError("countdown_timeout", msg, undefined, "info");
    if (state?.referenceId) {
      try {
        await invoke("update_transaction_session_note", {
          transactionCode: (state.referenceId || '').replace(/^MCH-/, 'TXN-'),
          sessionNote: "Countdown expired on frame selection page",
          closeReason: "timeout",
        });
      } catch (err) {
        appLogger.error(CTX, `update_transaction_session_note failed: ${err}`);
      }
    }
    navigate("/");
  };

  const handleNext = () => {
    if (!selectedFrame) return;
    navigate("/prepare-shooting", {
      state: { ...state, selectedFrame },
    });
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        height: "100vh",
        overflow: "hidden",
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <Countdown
        seconds={COUNTDOWN.FRAME_SELECTION.DURATION}
        onComplete={handleCountdownComplete}
        visible={COUNTDOWN.FRAME_SELECTION.VISIBLE}
      />

      <div className="page-main-content" style={{ marginTop: "60px" }}>
        {/* Row 1: Title */}
        <div className="page-row-top">
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              เลือกกรอบรูป
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              SELECT YOUR FRAME
            </p>
          </div>
        </div>

        {/* Row 2: Body – carousel + preview */}
        <div
          className="page-row-body"
          style={{ flexDirection: "column", gap: 0, padding: 0 }}
        >
          {loading ? (
            <div
              style={{
                color: "white",
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              กำลังโหลด...
            </div>
          ) : loadFailed && frames.length === 0 ? (
            <div
              style={{
                color: theme.fontColor,
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                textAlign: "center",
                padding: "0 40px",
              }}
            >
              <div style={{ fontSize: "22px" }}>โหลดกรอบรูปไม่สำเร็จ</div>
              <div style={{ fontSize: "16px", opacity: 0.8 }}>
                Couldn't load frames. Please check the connection and try again.
              </div>
              <button
                onClick={() => {
                  setLoading(true);
                  loadFrames();
                }}
                className="page-action-btn"
                style={{ background: theme.primaryColor, color: theme.textButtonColor }}
              >
                ลองใหม่ / Try again
              </button>
            </div>
          ) : (
            <>
              {/* Carousel */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "160px",
                  flexShrink: 0,
                  marginTop: "10px",
                }}
              >
                {/* Left arrow */}
                <button
                  onClick={scrollLeft}
                  style={{
                    position: "absolute",
                    left: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "45px",
                    height: "45px",
                    borderRadius: "50%",
                    backgroundColor: theme.primaryColor,
                    color: theme.textButtonColor,
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "22px",
                    cursor: "pointer",
                    zIndex: 10,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
                  }}
                >
                  ❮
                </button>

                {/* Scroll container */}
                <div
                  ref={scrollContainerRef}
                  className="hide-scrollbar"
                  onMouseDown={onMouseDown}
                  onMouseLeave={onMouseLeave}
                  onMouseUp={onMouseUp}
                  onMouseMove={onMouseMove}
                  style={{
                    display: "flex",
                    gap: "25px",
                    overflowX: "auto",
                    scrollBehavior: "smooth",
                    padding: "15px 60px",
                    WebkitOverflowScrolling: "touch",
                    width: "100%",
                    height: "100%",
                    alignItems: "center",
                    touchAction: "pan-x",
                    cursor: isDragging ? "grabbing" : "grab",
                    boxSizing: "border-box",
                  }}
                >
                  {frames.map((frame) => {
                    const isSelected = selectedFrame?._id === frame._id;
                    return (
                      <div
                        key={frame._id}
                        onClick={() => handleFrameClick(frame)}
                        style={{
                          flexShrink: 0,
                          cursor: "pointer",
                          overflow: "hidden",
                          transition: "all 0.2s",
                          backgroundColor: "#EEE",
                          boxShadow: isSelected
                            ? "0 8px 10px rgba(0,0,0,0.25)"
                            : "0 4px 5px rgba(0,0,0,0.1)",
                          lineHeight: 0, // ป้องกัน inline gap ใต้รูป
                          border: isSelected
                            ? `3px solid ${theme.primaryColor}`
                            : "3px solid transparent",
                          borderRadius: "5px",
                        }}
                      >
                        <LocalImage
                          src={(frame.previewUrl || frame.imageUrl) || undefined}
                          alt={frame.name}
                          draggable={false}
                          style={{
                            height: "128px",
                            width: "auto",
                            display: "block",
                            pointerEvents: "none",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Right arrow */}
                <button
                  onClick={scrollRight}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: "45px",
                    height: "45px",
                    borderRadius: "50%",
                    backgroundColor: theme.primaryColor,
                    color: theme.textButtonColor,
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "22px",
                    cursor: "pointer",
                    zIndex: 10,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
                  }}
                >
                  ❯
                </button>
              </div>

              {/* 3. รูปพรีวิว (Preview) - ย่อขนาดลงอีก และห้ามดันจนล้น */}
              <div
                style={{
                  flex: 1,
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  minHeight: 0,
                  overflow: "hidden",
                  padding: "10px 0",
                }}
              >
                {selectedFrame && (
                  <div
                    style={{
                      display: "inline-block",
                      backgroundColor: "#EEE",
                      overflow: "hidden",
                      lineHeight: 0,
                      boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                    }}
                  >
                    <LocalImage
                      src={selectedFrame.imageUrl || undefined}
                      alt="Selected"
                      style={{
                        height: "auto",
                        width: "auto",
                        maxHeight: "30vh",
                        maxWidth: "80vw",
                        objectFit: "contain",
                        display: "block",
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Footer: Next button */}
              <div className="page-row-footer">
                <button
                  onClick={handleNext}
                  disabled={!selectedFrame}
                  className="page-action-btn"
                  style={{
                    background: theme.primaryColor,
                    color: theme.textButtonColor,
                  }}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
        {/* end page-row-body */}
      </div>
      {/* end page-main-content */}

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        * { outline: none !important; -webkit-tap-highlight-color: transparent !important; }
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

