import React, { useState, useEffect, useRef } from "react";

interface CountdownProps {
  /** จำนวนวินาทีที่ต้องการนับถอยหลัง (default: 60) */
  seconds?: number;
  /** Callback function ที่จะถูกเรียกเมื่อนับถึง 0 */
  onComplete?: () => void;
  /** แสดง countdown หรือไม่ (default: true) */
  visible?: boolean;
  /** CSS class เพิ่มเติม */
  className?: string; // Kept for compatibility, though styles are inline
}

export default function Countdown({
  seconds = 60,
  onComplete,
  visible = true,
}: CountdownProps): React.JSX.Element | null {
  const [timeLeft, setTimeLeft] = useState<number>(seconds);
  const [isHovered, setIsHovered] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const hasCompletedRef = useRef(false);

  // keep latest onComplete
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // reset when seconds change
  useEffect(() => {
    setTimeLeft(seconds);
    hasCompletedRef.current = false;
  }, [seconds]);

  // main countdown interval (run once)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // stop interval
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  // fire onComplete when reach 0
  useEffect(() => {
    if (timeLeft === 0 && !hasCompletedRef.current) {
      hasCompletedRef.current = true;

      setTimeout(() => {
        onCompleteRef.current?.();
      }, 0);
    }
  }, [timeLeft]);

  if (!visible) {
    return null;
  }

  const minutes = Math.floor(timeLeft / 60);
  const remainingSeconds = timeLeft % 60;
  const displayTime = `${minutes}:${remainingSeconds
    .toString()
    .padStart(2, "0")}`;

  const isWarning = timeLeft <= 10 && timeLeft > 5;
  const isCritical = timeLeft <= 5;

  // Inline styles
  const containerStyle: React.CSSProperties = {
    position: "absolute",
    top: "3rem",
    right: "3rem",
    zIndex: 1000,
    pointerEvents: "none",
    opacity: 0.7,
  };

  let circleBackgroundColor = "rgba(0, 0, 0, 0.7)";
  let circleBorderColor = "#ffffff";
  let animationStyle = {};

  if (isWarning) {
    circleBackgroundColor = "rgba(255, 87, 34, 0.9)";
    circleBorderColor = "#ff5722";
    // React inline style doesn't support keyframes easily without a style tag or library.
    // simpler pulse effect using transition/transform could be done but keyframes need specific handling.
    // For now, we will omit the complex keyframe animation object in pure inline style
    // or we could use a simple scale loop if we used requestAnimationFrame, but that's complex.
    // We will stick to color changes for now to keep it simple and robust single-file.
  } else if (isCritical) {
    circleBackgroundColor = "rgba(244, 67, 54, 0.9)";
    circleBorderColor = "#f44336";
  }

  const circleStyle: React.CSSProperties = {
    width: "76px",
    height: "76px",
    borderRadius: "50%",
    backgroundColor: circleBackgroundColor,
    border: `2px solid ${circleBorderColor}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: isHovered
      ? "0 6px 16px rgba(0, 0, 0, 0.4)"
      : "0 4px 12px rgba(0, 0, 0, 0.3)",
    transition: "all 0.3s ease",
    transform: isHovered ? "scale(1.05)" : "scale(1)",
    ...animationStyle,
  };

  const textStyle: React.CSSProperties = {
    color: "#ffffff",
    fontSize: "24px",
    fontWeight: "bold",
    fontFamily: "'IBM Plex Sans Thai', sans-serif",
    textShadow: "0 2px 4px rgba(0, 0, 0, 0.5)",
    userSelect: "none",
  };

  return (
    <div style={containerStyle}>
      {/* Inject keyframes for pulse animation if needed, or just rely on color changes */}
      {(isWarning || isCritical) && (
        <style>
          {`
            @keyframes pulse {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.1); }
            }
            @keyframes pulse-fast {
              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.15); }
            }
          `}
        </style>
      )}
      <div
        style={{
          ...circleStyle,
          animation: isCritical
            ? "pulse-fast 0.5s infinite"
            : isWarning
              ? "pulse 1s infinite"
              : "none",
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <span style={textStyle}>{displayTime}</span>
      </div>
    </div>
  );
}
