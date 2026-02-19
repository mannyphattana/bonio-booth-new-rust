import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ThemeData, MachineData, FrameData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import HorizontalScroll from "../components/HorizontalScroll";

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
      className="page-container page-space-between"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        // ล็อคไม่ให้หน้าจอเลื่อนเด็ดขาด
        height: "100vh",
        overflow: "hidden",
        paddingTop: "20px",
        paddingBottom: "20px",
      }}
    >
      <Countdown
        seconds={COUNTDOWN.FRAME_SELECTION.DURATION}
        onComplete={() => navigate("/")}
        visible={COUNTDOWN.FRAME_SELECTION.VISIBLE}
      />

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
          {/* 2. ส่วนเลือกรูป (Carousel) - ฟิกความสูง */}
          <div
            style={{
              width: "100%",
              height: "140px",
              flexShrink: 0,
              marginTop: "10px",
            }}
          >
            <HorizontalScroll padding="0 60px" arrowColor={theme.fontColor}>
              {frames.map((frame) => (
                <div
                  key={frame._id}
                  onClick={() => setSelectedFrame(frame)}
                  style={{
                    flexShrink: 0,
                    width: "100px",
                    height: "130px",
                    margin: "0 8px",
                    cursor: "pointer",
                    border:
                      selectedFrame?._id === frame._id
                        ? `4px solid #e94560`
                        : "2px solid rgba(255,255,255,0.3)",
                    borderRadius: "10px",
                    overflow: "hidden",
                    transition: "all 0.2s",
                  }}
                >
                  <img
                    src={frame.previewUrl || frame.imageUrl}
                    alt={frame.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                </div>
              ))}
            </HorizontalScroll>
          </div>

          {/* 3. รูปพรีวิว (Preview) - ย่อขนาดลงอีก และห้ามดันจนล้น */}
          <div
            style={{
              flex: 1,
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 0, // สำคัญมาก!
              overflow: "hidden",
              padding: "10px 0",
            }}
          >
            {selectedFrame && (
              <img
                src={selectedFrame.imageUrl}
                alt="Selected"
                style={{
                  height: "auto",
                  width: "auto",
                  // ลดขนาดลงเหลือ 30% ของหน้าจอ (จากเดิมอาจจะ 45% หรือ 100%)
                  maxHeight: "30vh",
                  maxWidth: "80%",
                  objectFit: "contain",
                  filter: "drop-shadow(0 10px 30px rgba(0,0,0,0.4))",
                }}
              />
            )}
          </div>

          {/* 4. ปุ่ม Next (Footer) - ฟิกอยู่ล่างสุด */}
          <div
            style={{
              width: "100%",
              height: "100px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              flexShrink: 0,
              position: "relative",
              zIndex: 20,
            }}
          >
            <button
              onClick={handleNext}
              disabled={!selectedFrame}
              style={{
                background: "#e94560",
                color: "white",
                padding: "15px 100px",
                borderRadius: "50px",
                fontSize: "26px",
                fontWeight: "bold",
                boxShadow: "0 5px 20px rgba(233, 69, 96, 0.4)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Next
            </button>

            {/* Logo Timelab */}
            <div
              style={{
                position: "absolute",
                bottom: "10px",
                right: "40px",
                opacity: 0.8,
              }}
            >
              <span
                style={{ fontSize: "24px", fontWeight: "bold", color: "#fff" }}
              >
                timelab
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
