import { MemoryRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import { REFETCH_INTERVAL } from "./config/appConfig";
import { initSession, sendSessionLog } from "./utils/sessionManager";
import { appLogger } from "./utils/appLogger";
import { retryPendingUploads } from "./utils/retryUploadManager";
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
  isKsherEnabled?: boolean;
  [key: string]: any;
}

export interface FrameSlot {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  zIndex: number;
  rotate?: number; 
}

export interface FrameData {
  _id: string;
  name: string;
  code: string;
  imageUrl: string;
  imageSize?: string; 
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
  photoPreview?: string;
  video: string;
  videoPath?: string;
}

/** ส่ง pathname ไปให้ parent */
function RouteSync({
  onRouteChange,
}: {
  onRouteChange: (pathname: string) => void;
}) {
  const location = useLocation();
  useEffect(() => {
    onRouteChange(location.pathname);
  }, [location.pathname, onRouteChange]);
  return null;
}

function App() {
  const [machineData, setMachineData] = useState<MachineData | null>(null);
  const [themeData, setThemeData] = useState<ThemeData | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [showMaintenance, setShowMaintenance] = useState(false);
  const [maintenanceFromBackend, setMaintenanceFromBackend] = useState(false);
  const [maintenanceConfig, setMaintenanceConfig] = useState<
    "camera" | "printer" | "network" | "paper" | null
  >(null);
  const [lineUrl, setLineUrl] = useState<string>("");
  
  const maintenanceFromBackendRef = useRef(false); // Ref เพื่อให้ callback ที่มี deps:[] อ่านค่าล่าสุดได้

  const [isOnHomePage, setIsOnHomePage] = useState(true);
  const isOnHomePageRef = useRef(true); // 🚨 Ref สำหรับใช้เช็คสถานะแบบเรียลไทม์ ป้องกันค่าไม่อัปเดต
  const [pendingPaperOut, setPendingPaperOut] = useState(false);

  const initRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleRouteChange = useCallback((path: string) => {
    const isHome = path === "/";
    setIsOnHomePage(isHome);
    isOnHomePageRef.current = isHome;
  }, []);

  useEffect(() => {
    const savedCameraType = localStorage.getItem("cameraType");
    if (savedCameraType) {
      invoke("set_camera_type", { cameraType: savedCameraType }).catch(() => {});
    }

    // เริ่ม session tracking (crash recovery + new session)
    initSession().catch((e) => {
      appLogger.warn("[App]", `initSession failed: ${e}`);
    });

    // ฟัง shutdown-starting event → ส่ง session log ก่อน timer/OS shutdown
    const unlistenShutdown = listen("shutdown-starting", async () => {
      appLogger.info("[App]", "shutdown-starting received — sending session log (timer/auto)");
      await sendSessionLog("timer");
    });

    return () => {
      unlistenShutdown.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const savedMachineId = localStorage.getItem("machineId");
    if (savedMachineId) {
      initMachine(savedMachineId);
    }
  }, []);

  const initMachine = useCallback(
    async (machineId: string) => {
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
            setThemeData(
              initResult.data.theme || initResult.data.machine.theme,
            );
            setIsVerified(true);

            if (maintenanceConfig === "network") {
              setMaintenanceConfig(null);
              setShowMaintenance(false);
            }

            if (initResult.data.machine?.lineUrl) {
              setLineUrl(initResult.data.machine.lineUrl);
            }

            const backendMaintenance = !!initResult.data.machine?.isMaintenanceMode;
            const paperLevel = initResult.data.paperLevel ?? initResult.data.machine?.paperLevel ?? -1;

            if (backendMaintenance) {
              setShowMaintenance(true);
              setMaintenanceFromBackend(true);
              setMaintenanceConfig(null);
            } else if (paperLevel === 0) {
              // 🚨 ถ้ากระดาษเหลือ 0 ให้เช็คว่าอยู่หน้า Home ไหม
              if (isOnHomePageRef.current) {
                setShowMaintenance(true);
                setMaintenanceFromBackend(false);
                setMaintenanceConfig("paper");
              } else {
                setPendingPaperOut(true); // ฝากคิวไว้ก่อน ค่อยไปโชว์ตอนถึงหน้า Home
              }
            } else if (!backendMaintenance && paperLevel > 0 && maintenanceConfig === "paper") {
                setShowMaintenance(false);
                setMaintenanceConfig(null);
            }
          } else {
            throw new Error("init_machine returned unsuccessful response");
          }
        } else {
          throw new Error("verify_machine failed");
        }
      } catch (err) {
        appLogger.error("[App]", `initMachine error: ${err}`);
        setShowMaintenance(true);
        setMaintenanceConfig("network");
        setMaintenanceFromBackend(false);
      }
    },
    [maintenanceConfig],
  );

  useEffect(() => {
    if (maintenanceConfig === "network") {
      const savedMachineId = localStorage.getItem("machineId");
      if (savedMachineId) {
        initRetryTimerRef.current = setInterval(() => {
          initMachine(savedMachineId);
        }, REFETCH_INTERVAL.SYSTEM_MAINTENANCE * 1000);
      }
    } else {
      if (initRetryTimerRef.current) {
        clearInterval(initRetryTimerRef.current);
        initRetryTimerRef.current = null;
      }
    }

    return () => {
      if (initRetryTimerRef.current) {
        clearInterval(initRetryTimerRef.current);
        initRetryTimerRef.current = null;
      }
    };
  }, [maintenanceConfig, initMachine]);

  const handleMaintenanceMode = useCallback((enabled: boolean) => {
    setShowMaintenance(enabled);
    setMaintenanceFromBackend(enabled);
    maintenanceFromBackendRef.current = enabled;
    if (enabled) setMaintenanceConfig(null); 
  }, []);

  const handleConfigUpdated = useCallback(
    (configType: string) => {
      appLogger.info("[App]", `Config updated via SSE: ${configType}`);
      const savedMachineId = localStorage.getItem("machineId");
      if (savedMachineId) {
        initMachine(savedMachineId);
      }
    },
    [initMachine],
  );

  /**
   * รับ SSE event "request-live-log" จาก dashboard
   * ส่ง log snapshot กลับไปยัง backend เฉพาะเมื่ออยู่หน้า Home เท่านั้น
   * (ไม่ส่งระหว่าง session ถ่ายรูปหรือ payment เพื่อไม่รบกวน UX)
   */
  const handleRequestLiveLog = useCallback(async () => {
    if (!isOnHomePageRef.current) {
      appLogger.warn("[App]", "request-live-log ignored: not on home page (machine busy)");
      return;
    }

    appLogger.info("[App]", "request-live-log received — collecting and sending live log snapshot");

    const entries = appLogger.getEntries();
    const summary = appLogger.buildSummary();

    try {
      await invoke("send_live_log", { entries, summary });
      appLogger.info("[App]", "Live log snapshot sent successfully");
    } catch (e) {
      appLogger.error("[App]", `Failed to send live log: ${e}`);
    }
  }, []);

  const { destroy: destroySSE } = useSSE({
    machineId: machineData?._id || "",
    enabled: isVerified && !!machineData?._id,
    onMaintenanceMode: handleMaintenanceMode,
    onConfigUpdated: handleConfigUpdated,
    onRequestLiveLog: handleRequestLiveLog,
  });

  const { state: shutdownState, notifyActivity: notifyShutdownActivity } =
    useShutdown({
      enabled: isVerified,
    });

  const handleMaintenanceNeeded = useCallback(() => {
    setShowMaintenance(true);
  }, []);

  useDeviceCheck({
    enabled: isVerified,
    sendStartupReport: true,
    onMaintenanceNeeded: handleMaintenanceNeeded,
  });

  useAutoUpdate({ enabled: true, isOnHomePage });

  // Background retry สำหรับ pending uploads ที่ค้างไว้
  // เริ่มหลัง machine verified แล้ว 30 วินาที จากนั้น retry ทุก 10 นาที
  //
  // ยิงเฉพาะตอนตู้อยู่หน้า home (ไม่มีลูกค้าใช้งาน) — วิดีโอย้อนหลังไฟล์ละสิบกว่า MB
  // ถ้าไปยิงตอนลูกค้ากำลังถ่าย/รอ QR จะแย่งแบนด์วิดท์กับ upload ของรอบปัจจุบัน
  // ถึงรอบแล้วตู้ไม่ว่างก็ข้ามไปรอบถัดไป (อีก 10 นาที) — ไม่ได้ยกเลิก แค่เลื่อน
  useEffect(() => {
    if (!isVerified) return;

    appLogger.info("[App]", "Scheduling background retry for pending uploads");

    const runRetryWhenIdle = (label: string) => {
      if (!isOnHomePageRef.current) {
        appLogger.info(
          "[App]",
          `Skipping ${label} pending upload retry — booth is mid-session, will try next cycle`,
        );
        return;
      }
      appLogger.info("[App]", `Running ${label} pending upload retry`);
      retryPendingUploads().catch((e) => {
        appLogger.warn("[App]", `retryPendingUploads (${label}) failed: ${e}`);
      });
    };

    const initialTimer = setTimeout(() => runRetryWhenIdle("initial"), 30_000);
    const periodicInterval = setInterval(
      () => runRetryWhenIdle("periodic"),
      10 * 60 * 1000,
    ); // ทุก 10 นาที

    return () => {
      clearTimeout(initialTimer);
      clearInterval(periodicInterval);
    };
  }, [isVerified]);

  const handleMachineDataRefreshed = useCallback(
    (data: any) => {
      if (data.machine) {
        setMachineData(data.machine);
        if (data.theme) setThemeData(data.theme);
        if (data.machine?.lineUrl) setLineUrl(data.machine.lineUrl);

        const newMaintenanceMode = !!data.machine?.isMaintenanceMode;
        const newPaperLevel = data.paperLevel ?? data.machine?.paperLevel ?? -1;

        if (newMaintenanceMode) {
          setShowMaintenance(true);
          setMaintenanceFromBackend(true);
          maintenanceFromBackendRef.current = true;
          setMaintenanceConfig(null);
        } else {
          // 🔧 FIX: ถ้า backend ปิด maintenance แล้ว และเปิดอยู่จาก backend ให้ปิด overlay
          if (maintenanceFromBackendRef.current) {
            setShowMaintenance(false);
            setMaintenanceFromBackend(false);
            maintenanceFromBackendRef.current = false;
            setMaintenanceConfig(null);
          }
        }
        if (!newMaintenanceMode && newPaperLevel === 0) {
          // 🚨 กันเหนียว: เช็คว่าอยู่หน้าแรกจริงๆ ไหม
          if (isOnHomePageRef.current) {
            setShowMaintenance(true);
            setMaintenanceFromBackend(false);
            setMaintenanceConfig("paper");
          } else {
            setPendingPaperOut(true);
          }
        }
      }
    },
    [],
  );

  // 🚨 [พระเอกของงานนี้] ทำงานทันทีที่พอลูกค้ากลับมาถึงหน้า Home 
  useEffect(() => {
    if (isOnHomePage) {
      // 1. ถ้าระบบฝากคิวเอาไว้ว่ากระดาษหมด ให้เด้งทันที
      if (pendingPaperOut) {
        setShowMaintenance(true);
        setMaintenanceFromBackend(false);
        setMaintenanceConfig("paper");
        setPendingPaperOut(false);
      }

      // 2. ดึงข้อมูลตู้จากหลังบ้านมาเช็คอีกรอบกันเหนียว ทันทีที่แตะหน้า Home! (ข้ามการรอ 30 วินาที)
      const savedMachineId = localStorage.getItem("machineId");
      if (savedMachineId && isVerified) {
         invoke("init_machine").then((res: any) => {
             if (res.success && res.data) {
                 const pLevel = res.data.paperLevel ?? res.data.machine?.paperLevel ?? -1;
                 if (pLevel === 0) {
                     setShowMaintenance(true);
                     setMaintenanceFromBackend(false);
                     setMaintenanceConfig("paper");
                 }
             }
         }).catch(() => {});
      }
    }
  }, [isOnHomePage, pendingPaperOut, isVerified]);

  const handleConnectionLost = useCallback(() => {
    setShowMaintenance(true);
    setMaintenanceConfig("network");
    setMaintenanceFromBackend(false);
  }, []);

  useTimerShutdown({
    enabled: isVerified,
    isOnHomePage,
    onMachineDataRefreshed: handleMachineDataRefreshed,
    onConnectionLost: handleConnectionLost,
  });

  const handleMaintenanceResolved = useCallback(() => {
    setShowMaintenance(false);
    setMaintenanceFromBackend(false);
    setMaintenanceConfig(null);
    setPendingPaperOut(false);
  }, []);

  const handleFormatReset = () => {
    setMachineData(null);
    setThemeData(null);
    setIsVerified(false);
    setShowMaintenance(false);
    setPendingPaperOut(false);
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
      <RouteSync onRouteChange={handleRouteChange} />
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
          ) : maintenanceConfig === "paper" ? (
            <OutOfPaper
              theme={themeData!}
              lineUrl={lineUrl || ""}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
              isOverlay
              onPaperRefilled={handleMaintenanceResolved}
            />
          ) : (
            <Maintenance
              onResolved={handleMaintenanceResolved}
              lineUrl={lineUrl}
              backgroundSecond={themeData?.backgroundSecond}
              isNetworkError={maintenanceConfig === "network"}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
              isMaintenanceFromBackend={maintenanceFromBackend}
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
          element={
            <TermsAndServices
              theme={themeData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/get-help"
          element={
            <GetHelp
              theme={themeData!}
              lineUrl={lineUrl || ""}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />

        <Route
          path="/payment-selection"
          element={
            <PaymentSelection
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/coupon-entry"
          element={
            <CouponEntry
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/payment-qr"
          element={
            <PaymentQR
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/frame-selection"
          element={
            <FrameSelection
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/prepare-shooting"
          element={
            <PrepareShooting
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/main-shooting"
          element={
            <MainShooting
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/slot-selection"
          element={
            <SlotSelection
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/apply-filter"
          element={
            <ApplyFilter
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/photo-result"
          element={
            <PhotoResult
              theme={themeData!}
              machineData={machineData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/out-of-paper"
          element={
            <OutOfPaper
              theme={themeData!}
              lineUrl={lineUrl || ""}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
        <Route
          path="/request-image"
          element={
            <RequestImage
              theme={themeData!}
              onFormatReset={handleFormatReset}
              onBeforeClose={destroySSE}
            />
          }
        />
      </Routes>
    </Router>
  );
}

export default App;