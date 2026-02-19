import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type {
  ThemeData,
  MachineData,
  Capture,
  FrameSlot,
  FrameData,
} from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function SlotSelection({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();

  const captures: Capture[] = state.captures || [];
  const selectedFrame: FrameData = state.selectedFrame;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  const getFrameDimensions = () => {
    if (selectedFrame?.imageSize) {
      const parts = selectedFrame.imageSize.split("x");
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (w > 0 && h > 0) return { w, h };
      }
    }
    return { w: 1200, h: 3600 };
  };

  const { w: frameWidth, h: frameHeight } = getFrameDimensions();
  const frameAspectRatio = frameWidth / frameHeight;

  const [photoAssignments, setPhotoAssignments] = useState<{
    [slotIndex: number]: number;
  }>({});
  const [selectedPhotos, setSelectedPhotos] = useState<number[]>([]);
  const [scaleFactor, setScaleFactor] = useState({ x: 1, y: 1 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const frameImgRef = useRef<HTMLImageElement>(null);

  const getAssignedCount = () => selectedPhotos.length;

  const calculateScaleFactor = useCallback(() => {
    const container = containerRef.current;
    if (!container || !selectedFrame) return;

    const containerWidth = container.offsetWidth;
    const containerHeight = container.offsetHeight;

    const imgAspect = frameWidth / frameHeight;
    const containerAspect = containerWidth / containerHeight;

    let renderedWidth,
      renderedHeight,
      offsetX = 0,
      offsetY = 0;

    if (imgAspect > containerAspect) {
      renderedWidth = containerWidth;
      renderedHeight = containerWidth / imgAspect;
      offsetY = (containerHeight - renderedHeight) / 2;
    } else {
      renderedHeight = containerHeight;
      renderedWidth = containerHeight * imgAspect;
      offsetX = (containerWidth - renderedWidth) / 2;
    }

    setScaleFactor({
      x: renderedWidth / frameWidth,
      y: renderedHeight / frameHeight,
    });
    setImageOffset({ x: offsetX, y: offsetY });
  }, [selectedFrame, frameWidth, frameHeight]);

  useEffect(() => {
    if (selectedFrame) {
      const timer = setTimeout(calculateScaleFactor, 100);
      return () => clearTimeout(timer);
    }
  }, [calculateScaleFactor, selectedFrame]);

  useEffect(() => {
    window.addEventListener("resize", calculateScaleFactor);
    return () => window.removeEventListener("resize", calculateScaleFactor);
  }, [calculateScaleFactor]);

  const handlePhotoClick = useCallback(
    (idx: number) => {
      if (!selectedFrame) return;
      if (selectedPhotos.includes(idx)) {
        const newPhotos = selectedPhotos.filter((p) => p !== idx);
        setSelectedPhotos(newPhotos);
        const newAssign: any = {};
        newPhotos.forEach((p, i) => (newAssign[i] = p));
        setPhotoAssignments(newAssign);
      } else if (selectedPhotos.length < slots.length) {
        const newPhotos = [...selectedPhotos, idx];
        setSelectedPhotos(newPhotos);
        setPhotoAssignments({
          ...photoAssignments,
          [selectedPhotos.length]: idx,
        });
      }
    },
    [selectedFrame, selectedPhotos, photoAssignments, slots.length],
  );

  const handleNext = () => {
    if (getAssignedCount() < slots.length) return;
    const frameCaptures = slots.map((_, slotIdx) => {
      const captureIdx = photoAssignments[slotIdx];
      return captureIdx !== undefined ? captures[captureIdx] : captures[0];
    });
    navigate("/apply-filter", { state: { ...state, frameCaptures } });
  };

  if (!selectedFrame) return null;

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        padding: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Countdown */}
      <Countdown
        seconds={COUNTDOWN.SLOT_SELECTION.DURATION}
        onComplete={() => navigate("/")}
      />

      <div className="page-main-content" style={{ marginTop: "60px" }}>
        {/* Row 1: Title */}
        <div className="page-row-top">
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              เลือกรูปของคุณ
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              SELECT YOUR PHOTOS ({selectedPhotos.length}/{slots.length})
            </p>
          </div>
        </div>

        {/* Row 2: Body – frame + thumbnails */}
        <div
          className="page-row-body"
          style={{ flexDirection: "column", gap: "40px" }}
        >
          {/* Frame */}
          <div
            ref={containerRef}
            style={{
              position: "relative",
              width: "85%",
              height: "35vh",
              aspectRatio: `${frameAspectRatio}`,
              isolation: "isolate",
            }}
          >
            <img
              ref={frameImgRef}
              src={selectedFrame.imageUrl}
              alt=""
              onLoad={calculateScaleFactor}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                zIndex: 10,
                pointerEvents: "none",
              }}
            />

            {slots.map((slot, i) => {
              const captureIdx = photoAssignments[i];
              const slotX = slot.x * scaleFactor.x + imageOffset.x;
              const slotY = slot.y * scaleFactor.y + imageOffset.y;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    zIndex: 5,
                    overflow: "hidden",
                    left: `${slotX}px`,
                    top: `${slotY}px`,
                    width: `${slot.width * scaleFactor.x}px`,
                    height: `${slot.height * scaleFactor.y}px`,
                    borderRadius: `${slot.radius * scaleFactor.x}px`,
                    background: "rgba(0,0,0,0.05)",
                  }}
                >
                  {captureIdx !== undefined && (
                    <img
                      src={captures[captureIdx].photo}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* 3. Thumbnails */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "16px",
              justifyContent: "center",
              zIndex: 20,
            }}
          >
            {captures.map((cap, idx) => {
              const isSelected = selectedPhotos.includes(idx);
              const slotIdx = Object.keys(photoAssignments).find(
                (key) => photoAssignments[parseInt(key)] === idx,
              );
              return (
                <div
                  key={idx}
                  onClick={() => handlePhotoClick(idx)}
                  style={{
                    width: "110px",
                    height: "110px",
                    borderRadius: "15px",
                    overflow: "hidden",
                    border: isSelected
                      ? `3px solid ${theme.primaryColor}`
                      : "3px solid white",
                    cursor: "pointer",
                    transition: "0.2s",
                    position: "relative",
                    opacity: isSelected ? 0.6 : 1,
                    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
                  }}
                >
                  <img
                    src={cap.photo}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  {isSelected && (
                    <>
                      {/* Center Number */}
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          width: "56px",
                          height: "56px",
                          borderRadius: "50%",
                          border: `3px solid ${theme.primaryColor}`,
                          background: "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: theme.primaryColor,
                          fontSize: "32px",
                          fontWeight: "bold",
                          textShadow: "0 1px 3px rgba(0,0,0,0.5)",
                          zIndex: 10,
                        }}
                      >
                        {parseInt(slotIdx!) + 1}
                      </div>

                      {/* Top Right 'x' */}
                      <div
                        style={{
                          position: "absolute",
                          top: "4px",
                          right: "4px",
                          width: "20px",
                          height: "20px",
                          background: theme.primaryColor,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          zIndex: 20,
                        }}
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* end page-row-body */}

        {/* Row 3: Footer */}
        <div className="page-row-footer">
          <button
            onClick={handleNext}
            disabled={selectedPhotos.length < slots.length}
            className="page-action-btn"
            style={{
              background:
                selectedPhotos.length >= slots.length
                  ? theme.primaryColor
                  : "gray",
              color: theme.textButtonColor,
            }}
          >
            Next
          </button>
        </div>
        {/* end page-row-footer */}
      </div>
      {/* end page-main-content */}

      {/* Logo มุมขวาล่าง */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "40px",
          opacity: 0.8,
        }}
      >
        <span style={{ fontSize: "24px", fontWeight: "bold", color: "white" }}>
          timelab
        </span>
        <span
          style={{
            fontSize: "10px",
            display: "block",
            textAlign: "right",
            color: "white",
          }}
        >
          PHOTO BOOTH
        </span>
      </div>
    </div>
  );
}
