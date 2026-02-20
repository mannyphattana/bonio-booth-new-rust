import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, FrameData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function FrameSelection({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();
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

  useEffect(() => {
    loadFrames();
  }, []);

  const loadFrames = async () => {
    try {
      const result: any = await invoke("get_frames");
      if (result.success && result.data) {
        const frameList = Array.isArray(result.data)
          ? result.data
          : result.data.frames || [];
        setFrames(frameList);
        if (frameList.length > 0) {
          setSelectedFrame(frameList[0]);
        }
      }
    } catch (err) {
      console.error("Load frames error:", err);
    }
    setLoading(false);
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
    >
      <Countdown
        seconds={COUNTDOWN.FRAME_SELECTION.DURATION}
        onComplete={() => navigate("/")}
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
                        <img
                          src={frame.previewUrl || frame.imageUrl}
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
                    <img
                      src={selectedFrame.imageUrl}
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
    </div>
  );
}
