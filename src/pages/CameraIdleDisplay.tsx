import { useEffect, useRef } from "react";
import type { ThemeData } from "../App";

interface Props {
  theme: ThemeData;
}

/**
 * Idle screen แสดงบน display monitor ขณะที่ยังไม่ได้ถ่ายรูป
 * แสดงโลโก้ Bonio Booth พร้อม pulse animation
 */
export default function CameraIdleDisplay({ theme }: Props) {
  const circleRef = useRef<HTMLDivElement>(null);

  // Simple requestAnimationFrame pulse — no React state churn
  useEffect(() => {
    let frame = 0;
    let raf: number;
    const animate = () => {
      frame++;
      if (circleRef.current) {
        const scale = 0.92 + 0.08 * Math.sin((frame / 60) * Math.PI);
        circleRef.current.style.transform = `scale(${scale.toFixed(4)})`;
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: theme.background || "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Pulsing glow ring */}
      <div
        ref={circleRef}
        style={{
          width: 240,
          height: 240,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${theme.primaryColor || "#ffffff"}1a 0%, transparent 70%)`,
          border: `2px solid ${theme.primaryColor || "#ffffff"}33`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 48,
          willChange: "transform",
        }}
      >
        <span style={{ fontSize: 88, lineHeight: 1 }}>📷</span>
      </div>

      <h1
        style={{
          color: theme.fontColor || "#ffffff",
          fontSize: 40,
          fontWeight: 700,
          margin: 0,
          letterSpacing: 3,
          textAlign: "center",
        }}
      >
        Bonio Booth
      </h1>

      <p
        style={{
          color: theme.fontColor || "#aaaaaa",
          fontSize: 20,
          marginTop: 16,
          opacity: 0.5,
          textAlign: "center",
          letterSpacing: 1,
        }}
      >
        ยินดีต้อนรับ · Ready to Capture
      </p>
    </div>
  );
}
