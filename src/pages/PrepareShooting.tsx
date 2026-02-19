import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown"; // อย่าลืม import Countdown

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

const PREPARE_DURATION = 30; // seconds before auto-start

export default function PrepareShooting({ theme, machineData }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};
  useIdleTimeout();
  const [countdown, setCountdown] = useState(PREPARE_DURATION);
  const cameraCountdown = machineData.cameraCountdown || 5;

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleStart();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const handleStart = useCallback(() => {
    navigate("/main-shooting", { state });
  }, [navigate, state]);

  const handleBack = () => {
    navigate("/frame-selection", { state });
  };

  return (
    <div
      className="page-container page-space-between" // เพิ่ม class page-space-between
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        height: "100vh", // บังคับเต็มจอ
        overflow: "hidden" // ห้ามเลื่อน
      }}
    >
      {/* 1. Header Bar: จัดปุ่ม Back และ Countdown แบบเดียวกับหน้า FrameSelection */}
      <div 
        style={{
          position: "absolute",
          top: "20px",
          left: 0,
          width: "100%",
          padding: "0 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 100,
          height: "50px"
        }}
      >
        {/* ปุ่มย้อนกลับ */}
        <div style={{ position: "relative", width: "50px", height: "50px" }}>
           <BackButton onBackClick={handleBack} />
        </div>

        {/* ตัวนับเวลา (ใช้อันเดียวกับหน้า FrameSelection) */}
        <div style={{ position: "relative" }}>
           <Countdown seconds={300} onTimeout={() => navigate("/")} />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "40px 40px 0 40px", // ลด padding บนเพราะมี Header แล้ว
          boxSizing: "border-box",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          marginTop: "60px" // ดันเนื้อหาลงมาหลบ Header
        }}
      >
        {/* Row 1: Title (35%) */}
        <div
          style={{
            flex: "0 0 30%", // ลดลงนิดหน่อยเพื่อให้สมดุล
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <h1
              style={{
                color: theme.fontColor,
                fontSize: "3rem",
                fontWeight: 700,
                margin: "0 0 8px 0",
                lineHeight: 1.2,
              }}
            >
              เตรียมถ่ายภาพ
            </h1>
            <p
              style={{
                color: theme.fontColor,
                fontSize: "1.5rem",
                fontWeight: 500,
                margin: 0,
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              PREPARE FOR PHOTOSHOOT
            </p>
          </div>
        </div>

        {/* Row 2: Steps (flex: 1) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            padding: 10,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 48,
              width: "fit-content",
              height: "100%",
            }}
          >
            {/* Step 1 */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 40,
                width: "100%",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  minWidth: 80,
                  borderRadius: "50%",
                  background: theme.primaryColor,
                  color: theme.textButtonColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "3rem",
                  fontWeight: 700,
                }}
              >
                1
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 12,
                  flex: 1,
                }}
              >
                <svg
                  width="56"
                  height="56"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: theme.fontColor }}
                >
                  <path
                    d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx="12"
                    cy="13"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <path
                    d="M12 9v4M10 11h4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                <p
                  style={{
                    color: theme.fontColor,
                    fontSize: "1.5rem",
                    fontWeight: 500,
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {cameraCountdown} Second Per Image
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 40,
                width: "100%",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  minWidth: 80,
                  borderRadius: "50%",
                  background: theme.primaryColor,
                  color: theme.textButtonColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "3rem",
                  fontWeight: 700,
                }}
              >
                2
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 12,
                  flex: 1,
                }}
              >
                <svg
                  width="56"
                  height="56"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: theme.fontColor }}
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <circle cx="8" cy="10" r="2" fill="currentColor" />
                  <circle cx="16" cy="10" r="2" fill="currentColor" />
                  <circle cx="12" cy="16" r="2" fill="currentColor" />
                  <circle cx="6" cy="16" r="1" fill="currentColor" />
                  <circle cx="18" cy="16" r="1" fill="currentColor" />
                  <circle cx="10" cy="6" r="1" fill="currentColor" />
                  <circle cx="14" cy="6" r="1" fill="currentColor" />
                </svg>
                <p
                  style={{
                    color: theme.fontColor,
                    fontSize: "1.5rem",
                    fontWeight: 500,
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  Decorate Your Photo
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 40,
                width: "100%",
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  minWidth: 80,
                  borderRadius: "50%",
                  background: theme.primaryColor,
                  color: theme.textButtonColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "3rem",
                  fontWeight: 700,
                }}
              >
                3
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 12,
                  flex: 1,
                }}
              >
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <svg
                    width="56"
                    height="56"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{ color: theme.fontColor }}
                  >
                    <rect
                      x="3"
                      y="3"
                      width="18"
                      height="18"
                      rx="2"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <polygon points="10,8 10,16 16,12" fill="currentColor" />
                  </svg>
                  <svg
                    width="56"
                    height="56"
                    viewBox="0 0 24 24"
                    fill="none"
                    style={{ color: theme.fontColor }}
                  >
                    <polyline
                      points="6,9 6,2 18,2 18,9"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <path
                      d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                    <rect
                      x="6"
                      y="14"
                      width="12"
                      height="8"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
                <p
                  style={{
                    color: theme.fontColor,
                    fontSize: "1.5rem",
                    fontWeight: 500,
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  Print & Download
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Row 3: Start Button (25%) */}
        <div
          style={{
            flex: "0 0 25%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <button
            onClick={handleStart}
            style={{
              width: "90%",
              maxWidth: 500,
              padding: "16px 40px",
              fontSize: 26,
              fontWeight: 700,
              color: theme.textButtonColor,
              background: theme.primaryColor,
              border: "none",
              borderRadius: 35, // ปรับให้มนเท่าหน้าอื่น (จาก 16 เป็น 35)
              cursor: "pointer",
              minHeight: 60,
              letterSpacing: 0.5,
              boxShadow: "0 5px 20px rgba(0,0,0,0.3)", // เพิ่มเงาให้เหมือนหน้าอื่น
            }}
          >
            Start ({countdown}) {/* เอาเลข countdown มาโชว์ในปุ่มด้วย */}
          </button>
        </div>
      </div>
    </div>
  );
}