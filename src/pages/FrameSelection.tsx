import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, FrameData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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

  const handleSelectFrame = (frame: FrameData) => {
    setSelectedFrame(frame);
  };

  const handleNext = () => {
    if (!selectedFrame) return;
    navigate("/prepare-shooting", {
      state: {
        ...state,
        selectedFrame,
      },
    });
  };

  const handleBack = () => {
    navigate("/payment-selection", { state });
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "20px 0",
      }}
    >
      <button className="back-button" onClick={handleBack}>
        ←
      </button>

      <h1
        style={{
          color: theme.fontColor,
          fontSize: 24,
          marginTop: 60,
          marginBottom: 8,
        }}
      >
        เลือกกรอบรูป
      </h1>
      <p style={{ color: theme.fontColor, opacity: 0.8, marginBottom: 16 }}>
        SELECT FRAME
      </p>

      {loading ? (
        <div style={{ color: "#aaa", fontSize: 18, marginTop: 40 }}>
          กำลังโหลด...
        </div>
      ) : (
        <>
          {/* Scrollable frame thumbnails (top section) */}
          <div
            style={{
              width: "100%",
              overflowX: "auto",
              overflowY: "hidden",
              padding: "0 16px",
              display: "flex",
              gap: 12,
              flexShrink: 0,
            }}
          >
            {frames.map((frame) => (
              <button
                key={frame._id}
                onClick={() => handleSelectFrame(frame)}
                style={{
                  flexShrink: 0,
                  width: 100,
                  height: 140,
                //   borderRadius: 12,
                //   overflow: "hidden",
                  border:
                    selectedFrame?._id === frame._id
                      ? `3px solid ${theme.primaryColor}`
                      : "3px solid transparent",
                //   background: "rgba(0,0,0,0.3)",
                  padding: 0,
                }}
              >
                <img
                  src={frame.previewUrl || frame.imageUrl}
                  alt={frame.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </button>
            ))}
          </div>

          {/* Selected frame preview (center/bottom) */}
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 24px",
              width: "100%",
            }}
          >
            {selectedFrame ? (
              <div
                style={{
                  maxWidth: "70%",
                  maxHeight: "60vh",
                }}
              >
                <img
                  src={selectedFrame.imageUrl}
                  alt={selectedFrame.name}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>
            ) : (
              <p style={{ color: "#aaa" }}>กรุณาเลือกกรอบรูป</p>
            )}
          </div>

          {/* Frame name */}
          {selectedFrame && (
            <p
              style={{
                color: theme.fontColor,
                fontSize: 16,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              {selectedFrame.name}
              {selectedFrame.grid?.slots &&
                ` (${selectedFrame.grid.slots.length} photos)`}
            </p>
          )}

          {/* Next button */}
          <button
            className="primary-button"
            onClick={handleNext}
            disabled={!selectedFrame}
            style={{
              background: selectedFrame ? theme.primaryColor : "#444",
              color: theme.textButtonColor,
              marginBottom: 20,
            }}
          >
            ถัดไป / NEXT
          </button>
        </>
      )}
    </div>
  );
}
