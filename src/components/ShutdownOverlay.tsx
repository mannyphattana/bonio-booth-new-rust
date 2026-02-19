import { invoke } from "@tauri-apps/api/core";
import type { ShutdownState } from "../hooks/useShutdown";

interface Props {
  state: ShutdownState;
  onActivity?: () => void;
}

/**
 * Shutdown countdown overlay — shown when dashboard triggers a shutdown
 * or when the machine is outside operating hours (timer auto-shutdown).
 *
 * Behavior:
 * - Timer shutdown: tapping cancels the countdown entirely (let customer use the machine)
 * - Manual shutdown: tapping resets the countdown (buys more time but still shutting down)
 */
export default function ShutdownOverlay({ state, onActivity }: Props) {
  if (!state.isScheduled || state.isPaused) return null;

  const isTimer = state.reason === "timer";
  const isCloseApp = state.shutdownType === "close-app";
  // const isShutdown = state.shutdownType === "shutdown" || !state.shutdownType; // Default to shutdown if not specified

  const handleClick = () => {
    if (isTimer) {
      // Timer-based: cancel entirely so the customer can use the machine
      // The periodic poll will re-check and restart if still outside operating hours
      invoke("cancel_timer_shutdown").catch(console.error);
    } else {
      // Manual/dashboard: just reset the countdown
      onActivity?.();
    }
  };

  const minutes = Math.floor(state.remainingSeconds / 60);
  const seconds = state.remainingSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const progress = state.totalSeconds > 0
    ? ((state.totalSeconds - state.remainingSeconds) / state.totalSeconds) * 100
    : 0;

  // Determine title and description based on shutdown type
  const getTitle = () => {
    if (isTimer) {
      return "ขออภัย เนื่องจากอยู่นอกเวลาทำการ";
    }
    if (isCloseApp) {
      return "กำลังจะปิดแอพ";
    }
    return "กำลังจะปิดเครื่อง";
  };

  const getDescription = () => {
    if (isTimer) {
      return "เครื่องจะปิดตัวลงอีก " + timeStr + " นาที";
    }
    if (isCloseApp) {
      return "แอพจะปิดตัวลงอีก " + timeStr + " นาที";
    }
    return "ปิดเครื่องจาก Dashboard";
  };

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
      onClick={handleClick}
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
        {getTitle()}
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
        {getDescription()}
      </p>

      {/* Tap hint */}
      <p
        style={{
          color: isTimer ? "#4CAF50" : "#888",
          fontSize: isTimer ? 22 : 16,
          fontWeight: isTimer ? 600 : 400,
          animation: "pulse 2s ease-in-out infinite",
        }}
      >
        {isTimer
          ? "แตะหน้าจอเพื่อเริ่มใช้งาน"
          : "แตะหน้าจอเพื่อรีเซ็ตเวลา"}
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
