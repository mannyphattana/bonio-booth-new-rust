import type { ShutdownState } from "../hooks/useShutdown";

interface Props {
  state: ShutdownState;
  onActivity?: () => void;
}

/**
 * Shutdown countdown overlay — shown when dashboard triggers a shutdown.
 * Displays remaining time and allows user to tap to reset the countdown.
 */
export default function ShutdownOverlay({ state, onActivity }: Props) {
  if (!state.isScheduled || state.isPaused) return null;

  const minutes = Math.floor(state.remainingSeconds / 60);
  const seconds = state.remainingSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const progress = state.totalSeconds > 0
    ? ((state.totalSeconds - state.remainingSeconds) / state.totalSeconds) * 100
    : 0;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 99999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
      onClick={onActivity}
    >
      {/* Warning icon */}
      <div style={{ fontSize: 64, marginBottom: 24 }}>⚠️</div>

      {/* Title */}
      <h1
        style={{
          color: "#ff4444",
          fontSize: 36,
          fontWeight: 700,
          marginBottom: 16,
        }}
      >
        กำลังจะปิดเครื่อง
      </h1>

      {/* Countdown */}
      <div
        style={{
          color: "#fff",
          fontSize: 72,
          fontWeight: 700,
          fontFamily: "monospace",
          marginBottom: 24,
        }}
      >
        {timeStr}
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "60%",
          maxWidth: 400,
          height: 8,
          background: "rgba(255,255,255,0.2)",
          borderRadius: 4,
          overflow: "hidden",
          marginBottom: 32,
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            background: "#ff4444",
            borderRadius: 4,
            transition: "width 1s linear",
          }}
        />
      </div>

      {/* Reason */}
      <p style={{ color: "#aaa", fontSize: 18, marginBottom: 8 }}>
        {state.reason === "timer"
          ? "ปิดเครื่องตามเวลาที่ตั้งไว้"
          : "ปิดเครื่องจาก Dashboard"}
      </p>

      {/* Tap to cancel hint */}
      <p
        style={{
          color: "#888",
          fontSize: 16,
          animation: "pulse 2s ease-in-out infinite",
        }}
      >
        แตะหน้าจอเพื่อรีเซ็ตเวลา
      </p>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
