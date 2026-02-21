import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function Home({
  theme,
  machineData,
  onFormatReset,
  onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const [showContextMenu, setShowContextMenu] = useState(false);
  // Track whether the last interaction was a touch — used to block
  // touch-triggered contextmenu (two-finger tap / long-press) on touchscreens
  // while still allowing mouse right-click from AnyDesk / physical mouse.
  const touchActiveRef = useRef(false);

  const handleStart = useCallback(() => {
    if (showContextMenu) return;
    navigate("/payment-selection");
  }, [navigate, showContextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // If the contextmenu event was triggered by touch, ignore it
    if (touchActiveRef.current) return;
    setShowContextMenu(true);
  }, []);

  const handleTouchStart = useCallback(() => {
    touchActiveRef.current = true;
    // Reset after a short delay so mouse events are never permanently blocked
    setTimeout(() => { touchActiveRef.current = false; }, 800);
  }, []);

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.background})`,
        cursor: "pointer",
      }}
      onClick={handleStart}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      {/* Machine info badge */}
      <div
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          background: "rgba(0,0,0,0.5)",
          padding: "8px 16px",
          borderRadius: 20,
          fontSize: 12,
          color: "#aaa",
        }}
      >
        {machineData.machineName}
      </div>

      {/* Footer section with Terms & Help buttons */}
      <footer
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          flex: "0 0 30%",
          height: "30%",
          cursor: "default",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/terms-and-services")}
          style={{
            background: theme.textButtonColor || "rgba(255,255,255,0.15)",
            border: "none",
            color: theme?.primaryColor || theme.fontColor,
            cursor: "pointer",
            boxShadow: "none",
            padding: "0.5rem 2rem",
            fontSize: "x-large",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <p style={{ margin: 0 }}>ข้อตกลงการให้บริการ</p>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Terms & Conditions</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => navigate("/get-help")}
          style={{
            background: theme.textButtonColor || "rgba(255,255,255,0.15)",
            border: "none",
            color: theme?.primaryColor || theme.fontColor,
            cursor: "pointer",
            boxShadow: "none",
            padding: "0.5rem 2rem",
            fontSize: "x-large",
            borderRadius: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <p style={{ margin: 0 }}>ขอความช่วยเหลือ</p>
            <p style={{ margin: 0, fontSize: "1.2rem" }}>Need Help?</p>
          </div>
        </button>
      </footer>

      {/* Context Menu */}
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: translateY(0); }
          50% { opacity: 0.7; transform: translateY(-8px); }
        }
      `}</style>
    </div>
  );
}
