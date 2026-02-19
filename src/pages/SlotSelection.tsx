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
      {/* 1. Header: Title centered, Countdown absolute top-right (no BackButton per legacy) */}
      <Countdown seconds={300} onComplete={() => navigate("/")} />
      <header
        style={{
          width: "100%",
          height: "100px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 40px",
          zIndex: 100,
          position: "relative",
        }}
      >
        <div
          style={{
            textAlign: "center",
          }}
        >
          <h1
            style={{
              color: "#e94560",
              fontSize: "3.2rem",
              fontWeight: "bold",
              margin: 0,
              whiteSpace: "nowrap",
            }}
          >
            เลือกรูปของคุณ
          </h1>
          <p
            style={{
              color: theme.fontColor,
              opacity: 0.8,
              fontSize: "1.1rem",
              marginTop: "4px",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            SELECT YOUR PHOTOS ({selectedPhotos.length}/{slots.length})
          </p>
        </div>
      </header>

      {/* 2. Content Zone: รวมกรอบและ Thumbnail ไว้ด้วยกัน */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "40px",
          paddingBottom: "130px", // เว้นพื้นที่ให้ปุ่ม Next ด้านล่างมากขึ้น
        }}
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
            maxWidth: "420px",
            gap: "12px",
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
                  width: "85px",
                  height: "85px",
                  borderRadius: "15px",
                  overflow: "hidden",
                  border: isSelected
                    ? "3px solid #fff"
                    : "3px solid transparent",
                  backgroundColor: "black",
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
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
                {isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      top: 5,
                      right: 5,
                      width: "22px",
                      height: "22px",
                      background: "#e94560",
                      color: "white",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "12px",
                      fontWeight: "bold",
                    }}
                  >
                    {parseInt(slotIdx!) + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Footer: ปุ่ม Next ดันขึ้นและลดขนาด */}
      <footer
        style={{
          position: "absolute",
          bottom: "60px",
          width: "100%",
          display: "flex",
          justifyContent: "center",
          zIndex: 100,
        }}
      >
        <button
          onClick={handleNext}
          disabled={selectedPhotos.length < slots.length}
          style={{
            background:
              selectedPhotos.length >= slots.length
                ? "rgba(255, 255, 255, 0.9)"
                : "rgba(255, 255, 255, 0.4)",
            backdropFilter: "blur(10px)",
            color: selectedPhotos.length >= slots.length ? "#e94560" : "#fff",
            padding: "14px 80px", // ลดขนาดปุ่มลง
            borderRadius: "40px",
            fontSize: "20px",
            fontWeight: "bold",
            border: "none",
            cursor: "pointer",
            transition: "0.3s",
            boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
          }}
        >
          Next
        </button>
      </footer>

      {/* Logo มุมขวาล่าง */}
      <div
        style={{
          position: "absolute",
          bottom: "30px",
          right: "40px",
          opacity: 0.8,
        }}
      >
        <span
          style={{ fontSize: "24px", fontWeight: "bold", color: "#e94560" }}
        >
          timelab
        </span>
        <span
          style={{
            fontSize: "10px",
            display: "block",
            textAlign: "right",
            color: "#e94560",
          }}
        >
          PHOTO BOOTH
        </span>
      </div>
    </div>
  );
}
