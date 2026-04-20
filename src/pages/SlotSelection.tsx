import { useState, useCallback, useRef, useEffect } from "react";
import { appLogger } from "../utils/appLogger";
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
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function SlotSelection({ theme, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout({ transactionCode: state?.referenceId });
  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

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

    // Use the inner wrapper div for calculations to ensure aspect ratio is respected
    const wrapper = container.firstElementChild as HTMLDivElement;
    if (!wrapper) return;

    const containerWidth = wrapper.offsetWidth;
    const containerHeight = wrapper.offsetHeight;

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

  // ðŸ‘‡ðŸ‘‡ðŸ‘‡ à¹à¸à¹‰à¹„à¸‚ Logic à¸à¸²à¸£à¸ªà¸¥à¸±à¸šà¸£à¸¹à¸›à¹ƒà¸«à¸¡à¹ˆà¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¸•à¸£à¸‡à¸™à¸µà¹‰à¸„à¸£à¸±à¸š ðŸ‘‡ðŸ‘‡ðŸ‘‡
  const handleNext = () => {
    if (getAssignedCount() < slots.length) return;

    // 1. à¸”à¸¶à¸‡ Index à¸—à¸µà¹ˆà¸¥à¸¹à¸à¸„à¹‰à¸²à¹€à¸¥à¸·à¸­à¸à¸¡à¸²à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”
    let finalSelectedCaptureIndexes = slots.map((_, slotIdx) => {
      const captureIdx = photoAssignments[slotIdx];
      return captureIdx !== undefined ? captureIdx : 0;
    });

    // 2. à¸„à¹‰à¸™à¸«à¸²à¸à¸­à¸‡à¸«à¸™à¸¸à¸™: à¸”à¸¶à¸‡ Index à¹€à¸‰à¸žà¸²à¸°à¸£à¸¹à¸›à¸—à¸µà¹ˆ "à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸–à¸¹à¸à¹€à¸¥à¸·à¸­à¸" à¹à¸¥à¸° "à¸¡à¸µà¸§à¸´à¸”à¸µà¹‚à¸­à¸ªà¸¡à¸šà¸¹à¸£à¸“à¹Œ"
    let spareValidIndexes = captures
      .map((cap, idx) => ({ cap, idx }))
      .filter((item) => !finalSelectedCaptureIndexes.includes(item.idx)) // à¸•à¹‰à¸­à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸–à¸¹à¸à¹€à¸¥à¸·à¸­à¸à¹„à¸›à¹à¸¥à¹‰à¸§
      .filter((item) => item.cap && item.cap.videoPath && item.cap.videoPath.trim() !== "") // à¸§à¸´à¸”à¸µà¹‚à¸­à¸•à¹‰à¸­à¸‡à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¹„à¸”à¹‰
      .map((item) => item.idx);

    // 3. à¸ªà¹à¸à¸™à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸šà¸£à¸¹à¸›à¸—à¸µà¹ˆà¸¥à¸¹à¸à¸„à¹‰à¸²à¹€à¸¥à¸·à¸­à¸ à¸–à¹‰à¸²à¸£à¸¹à¸›à¹„à¸«à¸™à¸§à¸´à¸”à¸µà¹‚à¸­à¸žà¸±à¸‡ à¸ªà¸¥à¸±à¸šà¹€à¸­à¸²à¸‚à¸­à¸‡à¸”à¸µà¸¡à¸²à¹ƒà¸ªà¹ˆà¹à¸—à¸™à¸—à¸±à¹‰à¸‡à¸Šà¸¸à¸”
    finalSelectedCaptureIndexes = finalSelectedCaptureIndexes.map((currentIdx) => {
      const currentCap = captures[currentIdx];
      const isBroken = !currentCap || !currentCap.videoPath || currentCap.videoPath.trim() === "";

      if (isBroken) {
        appLogger.warn(__CTX__, `[Smart Fallback] à¸£à¸¹à¸›à¸—à¸µà¹ˆ ${currentIdx + 1} à¹„à¸¡à¹ˆà¸¡à¸µà¸§à¸´à¸”à¸µà¹‚à¸­!`);
        
        if (spareValidIndexes.length > 0) {
          // à¸”à¸¶à¸‡à¸à¸­à¸‡à¸«à¸™à¸¸à¸™à¸¡à¸²à¸ªà¸§à¸¡à¸£à¸­à¸¢ "à¸—à¸±à¹‰à¸‡à¸£à¸¹à¸›à¸ à¸²à¸žà¹à¸¥à¸°à¸§à¸´à¸”à¸µà¹‚à¸­" à¸ˆà¸°à¹„à¸”à¹‰à¹„à¸¡à¹ˆà¸¡à¸µà¸­à¸²à¸à¸²à¸£à¸ à¸²à¸žà¸à¸£à¸°à¸•à¸¸à¸
          const spareIdx = spareValidIndexes.shift()!;
          appLogger.info(__CTX__, `-> à¸ªà¸¥à¸±à¸šà¹„à¸›à¹ƒà¸Šà¹‰à¸£à¸¹à¸›à¹à¸¥à¸°à¸§à¸´à¸”à¸µà¹‚à¸­à¸ˆà¸²à¸à¸Šà¹ˆà¸­à¸‡à¸—à¸µà¹ˆ ${spareIdx + 1} à¹à¸—à¸™à¹€à¸£à¸µà¸¢à¸šà¸£à¹‰à¸­à¸¢`);
          return spareIdx; 
        } else {
          // à¸—à¹ˆà¸²à¹„à¸¡à¹‰à¸•à¸²à¸¢à¸à¹‰à¸™à¸«à¸µà¸š: à¸–à¹‰à¸²à¸à¸­à¸‡à¸«à¸™à¸¸à¸™à¸žà¸±à¸‡à¹€à¸à¸¥à¸µà¹‰à¸¢à¸‡à¸«à¸¡à¸”à¸•à¸¹à¹‰à¸ˆà¸£à¸´à¸‡à¹† à¹ƒà¸«à¹‰à¸”à¸¶à¸‡à¸§à¸´à¸”à¸µà¹‚à¸­à¹„à¸«à¸™à¸à¹‡à¹„à¸”à¹‰à¸—à¸µà¹ˆà¸ªà¸¡à¸šà¸¹à¸£à¸“à¹Œà¸¡à¸²à¹ƒà¸Šà¹‰à¸à¸±à¸™à¸£à¸°à¸šà¸šà¹à¸„à¸£à¸Š/à¸ˆà¸­à¸”à¸³
          const emergencyIdx = captures.findIndex(c => c && c.videoPath && c.videoPath.trim() !== "");
          return emergencyIdx !== -1 ? emergencyIdx : currentIdx;
        }
      }
      return currentIdx; // à¸–à¹‰à¸²à¸£à¸¹à¸›à¸›à¸à¸•à¸´ à¸à¹‡à¹ƒà¸Šà¹‰à¸£à¸¹à¸›à¹€à¸”à¸´à¸¡à¸—à¸µà¹ˆà¸¥à¸¹à¸à¸„à¹‰à¸²à¹€à¸¥à¸·à¸­à¸
    });

    // 4. à¸›à¸£à¸°à¸à¸­à¸šà¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹ƒà¸«à¹‰à¸žà¸£à¹‰à¸­à¸¡à¸ªà¹ˆà¸‡
    const frameCaptures = finalSelectedCaptureIndexes.map((idx) => captures[idx]);

    navigate("/apply-filter", {
      state: {
        ...state,
        frameCaptures,
        selectedCaptureIndexes: finalSelectedCaptureIndexes,
      },
    });
  };
  // ðŸ‘†ðŸ‘†ðŸ‘† à¸ˆà¸šà¸à¸²à¸£à¹à¸à¹‰à¹„à¸‚ ðŸ‘†ðŸ‘†ðŸ‘†

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
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      {/* Countdown */}
      <Countdown
        seconds={COUNTDOWN.SLOT_SELECTION.DURATION}
        onComplete={() => navigate("/")}
      />

      <div className="page-main-content" style={{ marginTop: "60px", height: "calc(100vh - 60px)", display: "flex", flexDirection: "column", padding: "10px 20px" }}>
        {/* Row 1: Title */}
        <div className="page-row-top" style={{ flex: "0 0 auto", marginBottom: "8px", padding: "40px 0" }}>
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              à¹€à¸¥à¸·à¸­à¸à¸£à¸¹à¸›à¸‚à¸­à¸‡à¸„à¸¸à¸“
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              SELECT YOUR PHOTOS ({selectedPhotos.length}/{slots.length})
            </p>
          </div>
        </div>

        {/* Row 2: Body â€“ frame + thumbnails */}
        <div
          className="page-row-body"
          style={{ flexDirection: "column", gap: "20px", flex: 1, overflow: "hidden" }}
        >
          {/* Frame */}
          <div
            ref={containerRef}
            style={{
              position: "relative",
              width: "100%",
              height: "52vh",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              isolation: "isolate",
            }}
          >
            <div style={{
              position: "relative",
              height: frameAspectRatio <= 1 ? "100%" : "auto",
              width: frameAspectRatio > 1 ? "100%" : "auto",
              maxHeight: "100%",
              maxWidth: "100%",
              aspectRatio: `${frameAspectRatio}`,
            }}>
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
                        src={captures[captureIdx].photoPreview || captures[captureIdx].photo}
                        alt=""
                        decoding="async"
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
          </div>

          {/* 3. Thumbnails */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "12px",
              justifyContent: "center",
              alignItems: "flex-start", // à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™à¸ˆà¸²à¸ center à¹€à¸›à¹‡à¸™ flex-start à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¸£à¸¹à¸›à¸Šà¸´à¸”à¸šà¸™
              alignContent: "flex-start", // à¸ˆà¸±à¸”à¸à¸¥à¸¸à¹ˆà¸¡à¸šà¸£à¸£à¸—à¸±à¸”à¹ƒà¸«à¹‰à¸Šà¸´à¸”à¸šà¸™
              zIndex: 20,
              width: "90%",
              flex: 1, // à¹ƒà¸«à¹‰à¸‚à¸¢à¸²à¸¢à¹€à¸•à¹‡à¸¡à¸žà¸·à¹‰à¸™à¸—à¸µà¹ˆà¸—à¸µà¹ˆà¹€à¸«à¸¥à¸·à¸­
              overflow: "hidden", // à¸‹à¹ˆà¸­à¸™ scrollbar
              padding: "10px",
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
                    width: "80px",
                    height: "80px",
                    borderRadius: "12px",
                    overflow: "hidden",
                    border: isSelected
                      ? `3px solid ${theme.primaryColor}`
                      : "3px solid white",
                    cursor: "pointer",
                    transition: "0.2s",
                    position: "relative",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={cap.photoPreview || cap.photo}
                    alt=""
                    decoding="async"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      opacity: isSelected ? 0.7 : 1,
                      filter: isSelected ? "brightness(0.7)" : "brightness(1)",
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
                          color: "white",
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
        <div className="page-row-footer" style={{ flex: "0 0 auto", paddingBottom: "50px", paddingTop: "10px", width: "60%" }}>
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
              padding: "12px 40px", // à¸¥à¸”à¸‚à¸™à¸²à¸”à¸›à¸¸à¹ˆà¸¡à¸¥à¸‡
              fontSize: "20px", // à¸¥à¸”à¸‚à¸™à¸²à¸”à¸•à¸±à¸§à¸­à¸±à¸à¸©à¸£à¸¥à¸‡
              borderRadius: "30px",
            }}
          >
            Next
          </button>
        </div>
        {/* end page-row-footer */}
      </div>
      {/* end page-main-content */}
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}
