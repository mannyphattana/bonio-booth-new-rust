import { useEffect, useState, useCallback } from "react";
import { MemoryRouter, Routes, Route, useNavigate } from "react-router-dom";
import MainShooting from "./pages/MainShooting";
import CameraIdleDisplay from "./pages/CameraIdleDisplay";
import { subscribeDualMonitor, emitDualMonitor } from "./utils/displayBroadcast";
import type { ThemeData, MachineData, Capture } from "./App";

// ─────────────────────────────────────────────────────────────────────────────
// Inner router component — sits inside MemoryRouter so it can call useNavigate
// ─────────────────────────────────────────────────────────────────────────────
function CameraRoutes({
  themeData,
  machineData,
}: {
  themeData: ThemeData;
  machineData: MachineData;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = subscribeDualMonitor((msg) => {
      if (msg.type === "start_shooting") {
        // Navigate to MainShooting with the same state the interactive window has
        navigate("/main-shooting", { state: msg.locationState });
      }
    });
    return unsub;
  }, [navigate]);

  const handleShootingComplete = useCallback(
    (captures: Capture[], _selectedFrame: any, locationState: any) => {
      // Notify interactive window that shooting is done
      emitDualMonitor({
        type: "shooting_done",
        captures,
        selectedFrame: locationState?.selectedFrame,
        locationState,
      });
      // Return to idle screen
      navigate("/");
    },
    [navigate]
  );

  return (
    <Routes>
      <Route path="/" element={<CameraIdleDisplay theme={themeData} />} />
      <Route
        path="/main-shooting"
        element={
          <MainShooting
            theme={themeData}
            machineData={machineData}
            onFormatReset={() => navigate("/")}
            onShootingComplete={handleShootingComplete}
          />
        }
      />
    </Routes>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component for the "camera" Tauri window
// ─────────────────────────────────────────────────────────────────────────────
export default function CameraApp() {
  const [themeData, setThemeData] = useState<ThemeData | null>(null);
  const [machineData, setMachineData] = useState<MachineData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Primary path: read data that the main window already saved to localStorage.
    // localStorage is shared across all Tauri webview windows (same origin).
    try {
      const rawMachine = localStorage.getItem("machineData");
      const rawTheme = localStorage.getItem("themeData");
      if (rawMachine && rawTheme) {
        setMachineData(JSON.parse(rawMachine));
        setThemeData(JSON.parse(rawTheme));
        return;
      }
    } catch {
      // fall through to error state
    }

    setLoadError("ไม่พบข้อมูลเครื่อง — กรุณาเปิดแอปหลักก่อน");
  }, []);

  // Loading / error state
  if (loadError || !themeData || !machineData) {
    return (
      <div
        style={{
          background: "#111",
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#555",
          fontSize: 18,
          fontFamily: "sans-serif",
        }}
      >
        {loadError ?? "กำลังโหลด..."}
      </div>
    );
  }

  return (
    <MemoryRouter>
      <CameraRoutes themeData={themeData} machineData={machineData} />
    </MemoryRouter>
  );
}
