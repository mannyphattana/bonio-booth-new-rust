import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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
  const selectedFrame = state.selectedFrame;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  // Get frame dimensions from grid or parse from imageSize
  const getFrameDimensions = () => {
    // Use imageSize first — slot coordinates are in imageSize pixel space
    if (selectedFrame?.imageSize) {
      const parts = selectedFrame.imageSize.split("x");
      if (parts.length === 2) {
        const w = parseInt(parts[0], 10);
        const h = parseInt(parts[1], 10);
        if (w > 0 && h > 0) return { w, h };
      }
    }
    // Fallback to grid dimensions
    if (selectedFrame?.grid?.width && selectedFrame?.grid?.height) {
      return { w: selectedFrame.grid.width, h: selectedFrame.grid.height };
    }
    return { w: 1200, h: 3600 };
  };

  const { w: frameWidth, h: frameHeight } = getFrameDimensions();
  const frameAspectRatio = frameWidth / frameHeight;

  // State: photoAssignments maps slotIndex → captureIndex
  const [photoAssignments, setPhotoAssignments] = useState<{
    [slotIndex: number]: number;
  }>({});
  const [selectedPhotos, setSelectedPhotos] = useState<number[]>([]);
  const [scaleFactor, setScaleFactor] = useState({ x: 1, y: 1 });
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const frameImgRef = useRef<HTMLImageElement>(null);

  const getAssignedCount = () => selectedPhotos.length;

  // Calculate scale factor based on container size vs frame original dimensions
  const calculateScaleFactor = useCallback(() => {
    const container = containerRef.current;
    if (!container || !selectedFrame) return;

    const containerWidth = container.offsetWidth || container.clientWidth;
    const containerHeight = container.offsetHeight || container.clientHeight;

    const imgAspect = frameWidth / frameHeight;
    const containerAspect = containerWidth / containerHeight;

    let renderedWidth: number;
    let renderedHeight: number;
    let offsetX = 0;
    let offsetY = 0;

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
    if (!selectedFrame) return;
    const timer = setTimeout(() => {
      calculateScaleFactor();
    }, 100);
    return () => clearTimeout(timer);
  }, [calculateScaleFactor]);

  useEffect(() => {
    window.addEventListener("resize", calculateScaleFactor);
    return () => window.removeEventListener("resize", calculateScaleFactor);
  }, [calculateScaleFactor]);

  // Handle frame image load to recalculate scale
  const handleFrameLoad = useCallback(() => {
    calculateScaleFactor();
  }, [calculateScaleFactor]);

  // Photo click: toggle selection (adapts reference PhotoDecorate pattern)
  const handlePhotoClick = useCallback(
    (photoIndex: number) => {
      if (!selectedFrame) return;

      if (selectedPhotos.includes(photoIndex)) {
        // Deselect: remove from selectedPhotos, rebuild assignments
        const newSelectedPhotos = selectedPhotos.filter((p) => p !== photoIndex);
        setSelectedPhotos(newSelectedPhotos);

        const newAssignments: { [slotIndex: number]: number } = {};
        newSelectedPhotos.forEach((p, i) => {
          newAssignments[i] = p;
        });
        setPhotoAssignments(newAssignments);
      } else if (selectedPhotos.length < slots.length) {
        // Select: add to next available slot
        const newSelectedPhotos = [...selectedPhotos, photoIndex];
        setSelectedPhotos(newSelectedPhotos);

        const newAssignments = { ...photoAssignments };
        newAssignments[selectedPhotos.length] = photoIndex;
        setPhotoAssignments(newAssignments);
      }
    },
    [selectedFrame, selectedPhotos, photoAssignments, slots.length]
  );

  const handleNext = () => {
    if (getAssignedCount() < slots.length) return;

    // Build the ordered captures for the frame
    const frameCaptures = slots.map((_, slotIdx) => {
      const captureIdx = photoAssignments[slotIdx];
      return captureIdx !== undefined ? captures[captureIdx] : captures[0];
    });

    navigate("/apply-filter", {
      state: {
        ...state,
        frameCaptures,
        frameCaptureIndices: Object.values(photoAssignments),
      },
    });
  };

  const handleBack = () => {
    navigate("/frame-selection", { state });
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "160px 0px",
        overflow: "hidden",
      }}
    >

      <button className="back-button" onClick={handleBack}>
        ←
      </button>

      <h1
        style={{
          color: theme.fontColor,
          fontSize: 22,
          marginTop: 60,
          marginBottom: 4,
          flexShrink: 0,
        }}
      >
        เลือกรูปลงกรอบ
      </h1>
      <p
        style={{
          color: theme.fontColor,
          opacity: 0.8,
          fontSize: 14,
          marginBottom: 12,
          flexShrink: 0,
        }}
      >
        SELECT PHOTOS FOR FRAME ({getAssignedCount()}/{slots.length})
      </p>

      {/* Frame preview with slots - uses object-fit contain pattern */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          flexShrink: 0,
          width: "100%",
          padding: "0 20px",
          boxSizing: "border-box",
        }}
      >
        <div
          ref={containerRef}
          style={{
            position: "relative",
            width: "100%",
            maxWidth: `calc(55vh * ${frameAspectRatio})`,
            aspectRatio: `${frameAspectRatio}`,
            isolation: "isolate",
            backgroundColor: "transparent",
          }}
        >
          {/* Frame image */}
          {selectedFrame?.imageUrl && (
            <img
              ref={frameImgRef}
              src={selectedFrame.imageUrl}
              alt="Frame"
              onLoad={handleFrameLoad}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                zIndex: 0,
                pointerEvents: "none",
              }}
            />
          )}

          {/* Slot previews - using scaleFactor + imageOffset */}
          {slots.map((slot, slotIdx) => {
            const slotX = slot.x * scaleFactor.x + imageOffset.x;
            const slotY = slot.y * scaleFactor.y + imageOffset.y;
            const slotWidth = slot.width * scaleFactor.x;
            const slotHeight = slot.height * scaleFactor.y;
            const scaledRadius = slot.radius * scaleFactor.x;
            const zIndex = slot.zIndex || 0;
            const rotation = slot.rotate || 0;
            const captureIdx = photoAssignments[slotIdx];
            const hasPhoto = captureIdx !== undefined;

            return (
              <div
                key={slotIdx}
                style={{
                  position: "absolute",
                  left: `${slotX}px`,
                  top: `${slotY}px`,
                  width: `${slotWidth}px`,
                  height: `${slotHeight}px`,
                  borderRadius: `${scaledRadius}px`,
                  overflow: "hidden",
                  zIndex: zIndex < 0 ? -1 : 1,
                  transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
                }}
              >
                {hasPhoto ? (
                  <img
                    src={captures[captureIdx].photo}
                    alt={`Slot ${slotIdx + 1}`}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "rgba(0,0,0,0.15)",
                      border: "1.5px dashed rgba(255,255,255,0.3)",
                      boxSizing: "border-box",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: `${scaledRadius}px`,
                    }}
                  >
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10 }}>
                      {slotIdx + 1}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Photo grid section */}
      <div
        style={{
          flex: 1,
          width: "100%",
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "center",
          alignContent: "center",
        }}
      >
        {captures.map((cap, idx) => {
          const sequenceNumber = selectedPhotos.indexOf(idx);
          const isPhotoSelected = sequenceNumber !== -1;

          return (
            <button
              key={idx}
              onClick={() => handlePhotoClick(idx)}
              style={{
                width: 90,
                height: 110,
                borderRadius: 12,
                overflow: "hidden",
                flexShrink: 0,
                border: isPhotoSelected
                  ? `3px solid ${theme.primaryColor}`
                  : "3px solid rgba(255,255,255,0.15)",
                opacity: isPhotoSelected ? 1 : 0.7,
                position: "relative",
                padding: 0,
                background: "transparent",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <img
                src={cap.photo}
                alt={`Capture ${idx + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              {isPhotoSelected && (
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: theme.primaryColor,
                    color: theme.textButtonColor,
                    fontSize: 13,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                  }}
                >
                  {sequenceNumber + 1}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Next button */}
      <button
        className="primary-button"
        onClick={handleNext}
        disabled={getAssignedCount() < slots.length}
        style={{
          background:
            getAssignedCount() >= slots.length ? theme.primaryColor : "#444",
          color: theme.textButtonColor,
          marginTop: 8,
          marginBottom: 20,
          flexShrink: 0,
        }}
      >
        ถัดไป / NEXT
      </button>
    </div>
  );
}
