import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { ThemeData, MachineData } from "../App";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function Home({ theme, machineData, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const [showContextMenu, setShowContextMenu] = useState(false);

  const handleStart = useCallback(() => {
    if (showContextMenu) return;
    navigate("/payment-selection");
  }, [navigate, showContextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setShowContextMenu(true);
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
    >
      {/* Touch anywhere to start overlay */}
      <div
        style={{
          textAlign: "center",
          animation: "pulse 2s ease-in-out infinite",
        }}
      >
        <p
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: theme.fontColor,
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          แตะเพื่อเริ่มต้น
        </p>
        <p
          style={{
            fontSize: 18,
            color: theme.fontColor,
            opacity: 0.8,
            marginTop: 8,
            textShadow: "0 2px 8px rgba(0,0,0,0.5)",
          }}
        >
          TAP ANYWHERE TO START
        </p>
      </div>

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
            color: theme.textPrimaryColor || theme.fontColor,
            cursor: "pointer",
            boxShadow: "none",
            padding: "0.5rem 2rem",
            fontSize: "x-large",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
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
            color: theme.textPrimaryColor || theme.fontColor,
            cursor: "pointer",
            boxShadow: "none",
            padding: "0.5rem 2rem",
            fontSize: "x-large",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: "0.5rem" }}>
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
