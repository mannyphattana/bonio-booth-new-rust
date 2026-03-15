import { useEffect, useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import { emitDualMonitor, subscribeDualMonitor } from "../utils/displayBroadcast";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

// ถ้า camera window ไม่ตอบสนองภายใน 90 วินาที ให้แสดง fallback
const FALLBACK_TIMEOUT_MS = 90_000;

/**
 * หน้าจอ interactive monitor ขณะถ่ายรูป (dual monitor mode)
 *
 * - Mount → ส่ง "start_shooting" ไปยัง camera window
 * - รับ "shooting_done" → navigate ไป /slot-selection พร้อม captures
 * - Fallback timeout → แสดงข้อความ error + ปุ่มกลับหน้าหลัก
 */
export default function DualMonitorShootingWait({
  theme,
  onFormatReset,
  onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [timedOut, setTimedOut] = useState(false);
  const { showContextMenu, setShowContextMenu } = useContextMenu();
  useIdleTimeout();

  const handleDone = useCallback(
    (captures: any[], locationState: any) => {
      navigate("/slot-selection", {
        state: {
          ...locationState,
          captures,
        },
      });
    },
    [navigate]
  );

  useEffect(() => {
    // Trigger the camera window to start the shooting sequence
    emitDualMonitor({
      type: "start_shooting",
      locationState: location.state,
    });

    // Listen for the camera window to finish
    const unsub = subscribeDualMonitor((msg) => {
      if (msg.type === "shooting_done") {
        handleDone(msg.captures, msg.locationState);
      }
    });

    const fallback = setTimeout(() => setTimedOut(true), FALLBACK_TIMEOUT_MS);

    return () => {
      unsub();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Timeout / error state ────────────────────────────────────────────────
  if (timedOut) {
    return (
      <div
        style={{
          background: theme.background || "#0a0a0a",
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: theme.fontColor || "#fff",
          fontFamily: "sans-serif",
        }}
      >
        <span style={{ fontSize: 56, marginBottom: 24 }}>⚠️</span>
        <h2 style={{ margin: "0 0 12px", fontSize: 28 }}>
          จอถ่ายรูปไม่ตอบสนอง
        </h2>
        <p style={{ opacity: 0.6, marginBottom: 40, fontSize: 16 }}>
          กรุณาตรวจสอบการเชื่อมต่อจอแสดงผล
        </p>
        <button
          onClick={() => navigate("/")}
          style={{
            background: theme.primaryColor || "#4CAF50",
            color: "#fff",
            border: "none",
            borderRadius: 14,
            padding: "16px 40px",
            fontSize: 20,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          กลับหน้าหลัก
        </button>
      </div>
    );
  }

  // ─── Shooting in progress ─────────────────────────────────────────────────
  return (
    <>
      <div
        style={{
          background: theme.background || "#0a0a0a",
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: theme.fontColor || "#fff",
          userSelect: "none",
          WebkitUserSelect: "none",
          fontFamily: "sans-serif",
        }}
      >
        {/* Pulsing camera icon */}
        <div
          style={{
            fontSize: 96,
            marginBottom: 40,
            animation: "dualPulse 1.5s ease-in-out infinite",
          }}
        >
          📷
        </div>

        <h1
          style={{
            margin: "0 0 16px",
            fontSize: 36,
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          กำลังถ่ายรูป...
        </h1>

        <p style={{ margin: 0, fontSize: 22, opacity: 0.75, textAlign: "center" }}>
          กรุณามองไปที่กล้องด้านหน้า
        </p>

        <p
          style={{
            margin: "12px 0 0",
            fontSize: 16,
            opacity: 0.4,
            textAlign: "center",
          }}
        >
          Please look at the camera
        </p>
      </div>

      <style>{`
        @keyframes dualPulse {
          0%, 100% { transform: scale(1); opacity: 0.9; }
          50%       { transform: scale(1.12); opacity: 1; }
        }
      `}</style>

      {showContextMenu && (
        <ContextMenu
          open={showContextMenu}
          onClose={() => setShowContextMenu(false)}
          onFormatReset={onFormatReset}
          onBeforeClose={onBeforeClose}
        />
      )}
    </>
  );
}
