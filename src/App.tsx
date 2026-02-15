import { MemoryRouter as Router, Routes, Route } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Home from "./pages/Home";
import PaymentSelection from "./pages/PaymentSelection";
import CouponEntry from "./pages/CouponEntry";
import PaymentQR from "./pages/PaymentQR";
import FrameSelection from "./pages/FrameSelection";
import PrepareShooting from "./pages/PrepareShooting";
import MainShooting from "./pages/MainShooting";
import SlotSelection from "./pages/SlotSelection";
import ApplyFilter from "./pages/ApplyFilter";
import PhotoResult from "./pages/PhotoResult";
import MachineVerify from "./pages/MachineVerify";
import Maintenance from "./pages/Maintenance";
import CameraConfigModal from "./components/CameraConfigModal";
import PrinterConfigModal from "./components/PrinterConfigModal";
import { useSSE } from "./hooks/useSSE";
import { useDeviceCheck } from "./hooks/useDeviceCheck";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import "./App.css";

export interface ThemeData {
  background: string;
  backgroundSecond: string;
  primaryColor: string;
  fontColor: string;
  textButtonColor: string;
}

export interface MachineData {
  _id: string;
  machineName: string;
  cameraCountdown: number;
  prices: Array<{ quantity: number; price: number; _id: string }>;
  frames: string[];
  theme: ThemeData;
  paperLevel: number;
  isMaintenanceMode: boolean;
  [key: string]: any;
}

export interface FrameSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  zIndex: number;
  rotate?: number; // Rotation in degrees (0-360)
}

export interface FrameData {
  _id: string;
  name: string;
  code: string;
  imageUrl: string;
  imageSize?: string; // Format: "widthxheight" e.g. "1200x1800"
  orientation?: "portrait" | "landscape";
  previewUrl?: string;
  grid: {
    width: number;
    height: number;
    slots: FrameSlot[];
  };
  [key: string]: any;
}

export interface Capture {
  photo: string;
  video: string;
  videoPath?: string;
}

function App() {
  const [machineData, setMachineData] = useState<MachineData | null>(null);
  const [themeData, setThemeData] = useState<ThemeData | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintenanceConfig, setMaintenanceConfig] = useState<"camera" | "printer" | null>(null);
  const [lineUrl, setLineUrl] = useState<string>("");

  useEffect(() => {
    const savedMachineId = localStorage.getItem("machineId");
    if (savedMachineId) {
      initMachine(savedMachineId);
    }
  }, []);

  const initMachine = async (machineId: string) => {
    try {
      await invoke("set_machine_config", {
        machineId,
        machinePort: localStorage.getItem("machinePort") || "44444",
      });
      const verifyResult: any = await invoke("verify_machine", { machineId });
      if (verifyResult.success) {
        const initResult: any = await invoke("init_machine");
        if (initResult.success && initResult.data?.machine) {
          setMachineData(initResult.data.machine);
          setThemeData(initResult.data.theme || initResult.data.machine.theme);
          setIsVerified(true);

          // Extract lineUrl from workspace/theme if available
          if (initResult.data.machine?.lineUrl) {
            setLineUrl(initResult.data.machine.lineUrl);
          }

          // Check if backend set maintenance mode
          if (initResult.data.machine?.isMaintenanceMode) {
            setShowMaintenance(true);
          }
        }
      }
    } catch (err) {
      console.error("Init error:", err);
    }
  };

  // SSE connection - receive events from backend
  const { disconnect: disconnectSSE } = useSSE({
    machineId: machineData?._id || "",
    enabled: isVerified && !!machineData?._id,
    onShutdown: (countdownMinutes) => {
      console.log(`[SSE] Shutdown scheduled in ${countdownMinutes} minutes`);
      // Could show a countdown overlay here
    },
    onMaintenanceMode: (enabled) => {
      setShowMaintenance(enabled);
    },
  });

  // Device monitoring - centralized, runs when verified
  const handleMaintenanceNeeded = useCallback(() => {
    setShowMaintenance(true);
  }, []);

  useDeviceCheck({
    enabled: isVerified,
    sendStartupReport: true,
    onMaintenanceNeeded: handleMaintenanceNeeded,
  });

  // Auto-update check every 5 minutes
  useAutoUpdate({ enabled: isVerified });

  const handleMaintenanceResolved = useCallback(() => {
    setShowMaintenance(false);
    setMaintenanceConfig(null);
  }, []);

  const handleFormatReset = () => {
    setMachineData(null);
    setThemeData(null);
    setIsVerified(false);
    setShowMaintenance(false);
  };

  if (!isVerified) {
    return (
      <MachineVerify
        onVerified={(data) => {
          setMachineData(data.machine);
          setThemeData(data.theme || data.machine?.theme);
          setIsVerified(true);
          localStorage.setItem("machineId", data.machine._id);
        }}
      />
    );
  }

  return (
    <Router>
      {/* Maintenance overlay - blocks all usage when devices disconnected */}
      {showMaintenance && (
        <>
          {maintenanceConfig === "camera" ? (
            <CameraConfigModal
              open={true}
              onClose={() => setMaintenanceConfig(null)}
            />
          ) : maintenanceConfig === "printer" ? (
            <PrinterConfigModal
              open={true}
              onClose={() => setMaintenanceConfig(null)}
            />
          ) : (
            <Maintenance
              onResolved={handleMaintenanceResolved}
              onOpenConfig={(type) => setMaintenanceConfig(type)}
              lineUrl={lineUrl}
              backgroundSecond={themeData?.backgroundSecond}
            />
          )}
        </>
      )}

      <Routes>
        <Route path="/" element={<Home theme={themeData!} machineData={machineData!} onFormatReset={handleFormatReset} onBeforeClose={disconnectSSE} />} />
        <Route path="/payment-selection" element={<PaymentSelection theme={themeData!} machineData={machineData!} />} />
        <Route path="/coupon-entry" element={<CouponEntry theme={themeData!} machineData={machineData!} />} />
        <Route path="/payment-qr" element={<PaymentQR theme={themeData!} machineData={machineData!} />} />
        <Route path="/frame-selection" element={<FrameSelection theme={themeData!} machineData={machineData!} />} />
        <Route path="/prepare-shooting" element={<PrepareShooting theme={themeData!} machineData={machineData!} />} />
        <Route path="/main-shooting" element={<MainShooting theme={themeData!} machineData={machineData!} />} />
        <Route path="/slot-selection" element={<SlotSelection theme={themeData!} machineData={machineData!} />} />
        <Route path="/apply-filter" element={<ApplyFilter theme={themeData!} machineData={machineData!} />} />
        <Route path="/photo-result" element={<PhotoResult theme={themeData!} machineData={machineData!} />} />
      </Routes>
    </Router>
  );
}

export default App;
