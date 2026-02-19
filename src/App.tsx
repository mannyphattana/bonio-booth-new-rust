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
import TermsAndServices from "./pages/TermsAndServices";
import GetHelp from "./pages/GetHelp";
import OutOfPaper from "./pages/OutOfPaper";
import RequestImage from "./pages/RequestImage";
import CameraConfigModal from "./components/CameraConfigModal";
import PrinterConfigModal from "./components/PrinterConfigModal";
import ShutdownOverlay from "./components/ShutdownOverlay";
import { useSSE } from "./hooks/useSSE";
import { useShutdown } from "./hooks/useShutdown";
import { useDeviceCheck } from "./hooks/useDeviceCheck";
import { useAutoUpdate } from "./hooks/useAutoUpdate";
import { useTimerShutdown } from "./hooks/useTimerShutdown";
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
  const [maintenanceConfig, setMaintenanceConfig] = useState<
    "camera" | "printer" | null
  >(null);
  const [lineUrl, setLineUrl] = useState<string>("");

  // Restore camera type from localStorage to Rust AppState on startup
  // Otherwise AppState defaults to "webcam" even if user configured "canon"
  useEffect(() => {
    const savedCameraType = localStorage.getItem("cameraType");
    if (savedCameraType) {
      invoke("set_camera_type", { cameraType: savedCameraType }).catch(
        () => {},
      );
    }
  }, []);

  useEffect(() => {
    const savedMachineId = localStorage.getItem("machineId");
    if (savedMachineId) {
      initMachine(savedMachineId);
    }
  }, []);

  const initMachine = useCallback(async (machineId: string) => {
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
  }, []);

  // SSE connection - receive events from backend
  // Shutdown events are handled directly in Rust backend (shutdown manager)
  // Use stable callbacks to prevent unnecessary reconnects
  const handleMaintenanceMode = useCallback((enabled: boolean) => {
    setShowMaintenance(enabled);
  }, []);

  const handleConfigUpdated = useCallback((configType: string) => {
    console.log("[App] Config updated via SSE:", configType);
    // Re-fetch machine & theme data from backend
    const savedMachineId = localStorage.getItem("machineId");
    if (savedMachineId) {
      initMachine(savedMachineId);
    }
  }, [initMachine]);

  const { destroy: destroySSE } = useSSE({
    machineId: machineData?._id || "",
    enabled: isVerified && !!machineData?._id,
    onMaintenanceMode: handleMaintenanceMode,
    onConfigUpdated: handleConfigUpdated,
  });

  // Shutdown countdown — listens to Rust shutdown manager events
  const { state: shutdownState, notifyActivity: notifyShutdownActivity } =
    useShutdown({
      enabled: isVerified,
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

  // Timer Auto-Shutdown — polls backend every 30s to check operating hours
  // When outside operating hours, starts a 2-minute shutdown countdown
  // Only refresh machineData if it actually changed (prevent unnecessary re-renders)
  const handleMachineDataRefreshed = useCallback((data: any) => {
    if (data.machine) {
      // Only update if machineId changed or if critical fields changed
      const currentMachineId = machineData?._id;
      const newMachineId = data.machine._id;
      
      if (currentMachineId !== newMachineId) {
        // Machine changed, update everything
        setMachineData(data.machine);
        if (data.theme) setThemeData(data.theme);
        if (data.machine?.lineUrl) setLineUrl(data.machine.lineUrl);
      } else {
        // Same machine, only update if critical fields changed
        const currentPaperLevel = machineData?.paperLevel;
        const newPaperLevel = data.machine.paperLevel;
        const currentMaintenanceMode = machineData?.isMaintenanceMode;
        const newMaintenanceMode = data.machine.isMaintenanceMode;
        
        if (
          currentPaperLevel !== newPaperLevel ||
          currentMaintenanceMode !== newMaintenanceMode ||
          machineData?.lineUrl !== data.machine?.lineUrl ||
          machineData?.cameraCountdown !== data.machine?.cameraCountdown
        ) {
          setMachineData(data.machine);
          if (data.theme) setThemeData(data.theme);
          if (data.machine?.lineUrl) setLineUrl(data.machine.lineUrl);
        }
      }
    }
  }, [machineData]);

  useTimerShutdown({
    enabled: isVerified,
    onMachineDataRefreshed: handleMachineDataRefreshed,
  });

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
      {/* Shutdown countdown overlay */}
      <ShutdownOverlay
        state={shutdownState}
        onActivity={notifyShutdownActivity}
      />

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
        <Route
          path="/"
          element={
            <Home
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/terms-and-services"
          element={<TermsAndServices theme={themeData!} />}
        />
        <Route
          path="/get-help"
          element={
            <GetHelp theme={themeData!} lineUrl={lineUrl || ""} /> // Pass lineUrl from state
          }
        />

        <Route
          path="/payment-selection"
          element={
            <PaymentSelection theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/coupon-entry"
          element={
            <CouponEntry theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/payment-qr"
          element={<PaymentQR theme={themeData!} machineData={machineData!} />}
        />
        <Route
          path="/frame-selection"
          element={
            <FrameSelection theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/prepare-shooting"
          element={
            <PrepareShooting theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/main-shooting"
          element={
            <MainShooting theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/slot-selection"
          element={
            <SlotSelection theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/apply-filter"
          element={
            <ApplyFilter theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/photo-result"
          element={
            <PhotoResult theme={themeData!} machineData={machineData!} />
          }
        />
        <Route
          path="/out-of-paper"
          element={<OutOfPaper theme={themeData!} lineUrl={lineUrl || ""} />}
        />
        <Route
          path="/request-image"
          element={<RequestImage theme={themeData!} />}
        />
      </Routes>
    </Router>
  );
}

export default App;
