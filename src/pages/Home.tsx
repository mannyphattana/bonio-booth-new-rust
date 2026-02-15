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
          position: "absolute",
          bottom: 80,
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
