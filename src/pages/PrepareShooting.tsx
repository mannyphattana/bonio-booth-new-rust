import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";

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
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
      }}
    >

      <button className="back-button" onClick={handleBack}>
        ←
      </button>

      <div className="countdown-badge">{countdown}s</div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 32,
          padding: 24,
          maxWidth: 500,
        }}
      >
        {/* Title */}
        <div style={{ textAlign: "center" }}>
          <h1
            style={{
              color: theme.fontColor,
              fontSize: 36,
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            เตรียมถ่ายภาพ
          </h1>
          <p style={{ color: theme.fontColor, opacity: 0.8, fontSize: 20 }}>
            PREPARE FOR PHOTOSHOOT
          </p>
        </div>

        {/* Steps */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            width: "100%",
          }}
        >
          {/* Step 1 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
            //   background: "rgba(0,0,0,0.3)",
              padding: "20px 24px",
              borderRadius: 16,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: theme.primaryColor,
                color: theme.textButtonColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              1
            </div>
            <div>
              <div style={{ fontSize: 48, marginBottom: 4 }}>📸</div>
              <p style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>
                {cameraCountdown} Second Per Image
              </p>
              <p style={{ color: "#aaa", fontSize: 14 }}>
                แต่ละรูปจะมีเวลานับถอยหลัง {cameraCountdown} วินาที
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
            //   background: "rgba(0,0,0,0.3)",
              padding: "20px 24px",
              borderRadius: 16,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: theme.primaryColor,
                color: theme.textButtonColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              2
            </div>
            <div>
              <div style={{ fontSize: 48, marginBottom: 4 }}>🎨</div>
              <p style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>
                Decorate Your Photo
              </p>
              <p style={{ color: "#aaa", fontSize: 14 }}>
                เลือกตกแต่งรูปภาพตามใจชอบ
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
            //   background: "rgba(0,0,0,0.3)",
              padding: "20px 24px",
              borderRadius: 16,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: theme.primaryColor,
                color: theme.textButtonColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              3
            </div>
            <div>
              <div style={{ fontSize: 48, marginBottom: 4 }}>🖨️</div>
              <p style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>
                Print & Download
              </p>
              <p style={{ color: "#aaa", fontSize: 14 }}>
                พิมพ์รูปและดาวน์โหลดผ่าน QR Code
              </p>
            </div>
          </div>
        </div>

        {/* Start button */}
        <button
          className="primary-button"
          onClick={handleStart}
          style={{
            background: theme.primaryColor,
            color: theme.textButtonColor,
            fontSize: 24,
            padding: "20px 64px",
            marginTop: 16,
          }}
        >
          Start ▶
        </button>
      </div>
    </div>
  );
}
