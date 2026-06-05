import { useEffect, useRef, useCallback } from "react";
import { appLogger } from "../utils/appLogger";
import { invoke } from "@tauri-apps/api/core";
import { DEVICE_CHECK } from "../config/appConfig";
import { logError } from "../utils/logger";

const CTX = "[useDeviceCheck]";

// DS-RX1 และ printer บางรุ่นจะ re-enumerate USB ชั่วคราว (2-3 วิ) ระหว่าง wakeup/ribbon load
// ใช้ debounce ก่อนยิง alert เพื่อกรอง false disconnect ออก
const PRINTER_DISCONNECT_DEBOUNCE_MS = 5000;

interface DeviceCheckOptions {
  enabled?: boolean;
  intervalMs?: number;
  onMaintenanceNeeded?: () => void;
  /** Called on first check to send startup report */
  sendStartupReport?: boolean;
}

interface DeviceState {
  cameraConnected: boolean;
  printerConnected: boolean;
}

/**
 * Enhanced device monitoring hook.
 * - Tracks configured camera and printer from localStorage
 * - Detects disconnect/reconnect state transitions
 * - Sends API notifications (device-alert, device-reconnected, device-status-report)
 * - Triggers maintenance mode callback on disconnect
 */
export function useDeviceCheck(options: DeviceCheckOptions = {}) {
  const {
    enabled = true,
    intervalMs = 3000,
    onMaintenanceNeeded,
    sendStartupReport = false,
  } = options;

  const prevStateRef = useRef<DeviceState | null>(null);
  const isFirstCheckRef = useRef(true);
  const alertSentRef = useRef<{ camera: boolean; printer: boolean }>({
    camera: false,
    printer: false,
  });
  // Debounce timer สำหรับ printer disconnect
  // ถ้า printer reconnect ก่อน timer ยิง = brief re-enum → ยกเลิก alert
  const printerDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkDevices = useCallback(async () => {
    if (!enabled) return;

    let cameraConnected = false;
    let printerConnected = false;
    let cameraName = "";
    let printerName = "";
    let availablePrinterNames: string[] = [];

    // --- Check camera ---
    const cameraType = localStorage.getItem("cameraType") || "webcam";
    const isConfiguredCamera =
      cameraType === "webcam"
        ? !!localStorage.getItem("selectedWebcamId")
        : !!localStorage.getItem("selectedCameraName");

    if (cameraType === "webcam") {
      const savedId = localStorage.getItem("selectedWebcamId");
      const savedLabel = localStorage.getItem("selectedCameraLabel") || "Webcam";
      cameraName = savedLabel;
      if (savedId) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === "videoinput");
          const found = videoDevices.find((d) => d.deviceId === savedId);
          cameraConnected = !!found;
          if (found && found.label) cameraName = found.label;
        } catch {
          // can't enumerate - assume connected
          cameraConnected = true;
        }
      }
    } else {
      // DSLR
      const savedName = localStorage.getItem("selectedCameraName") || "";
      cameraName = savedName;
      if (savedName) {
        try {
          const cameras: any[] = await invoke("list_dslr_cameras");
          cameraConnected = cameras.some((c: any) => c.name === savedName);
        } catch {
          cameraConnected = false;
        }
      }
    }

    // --- Check printer ---
    const savedPrinter = localStorage.getItem("selectedPrinter") || "";
    printerName = savedPrinter;
    const isConfiguredPrinter = !!savedPrinter;

    let printerLastStatus = "";
    if (savedPrinter) {
      try {
        const printers: any[] = await invoke("get_printers");
        availablePrinterNames = printers.map((p: any) => p.name);
        const foundPrinter = printers.find((p: any) => p.name === savedPrinter);
        printerConnected = foundPrinter?.is_online || false;
        if (foundPrinter?.status) printerLastStatus = foundPrinter.status;

        
      } catch (err) {
        appLogger.error(CTX, "[useDeviceCheck] Error checking printers:", err);
        printerConnected = false;
      }
    }

    const currentState: DeviceState = { cameraConnected, printerConnected };
    const prevState = prevStateRef.current;

    // --- First check: send startup report ---
    if (isFirstCheckRef.current) {
      isFirstCheckRef.current = false;

      if (sendStartupReport) {
        try {
          await invoke("send_device_status_report", {
            isStartup: true,
            cameraConfigured: isConfiguredCamera,
            cameraFound: cameraConnected,
            cameraDeviceName: cameraName || "ไม่ได้ตั้งค่า",
            printerConfigured: isConfiguredPrinter,
            printerFound: printerConnected,
            printerDeviceDetail: printerName ? `Main: ${printerName}` : "ไม่ได้ตั้งค่า",
            printerAvailableNames: availablePrinterNames,
          });
        } catch {
          /* ignore startup report errors */
        }
      }

      // If either device is configured but not found on startup → maintenance
      // (ข้ามถ้า ALLOW_TEST_WITHOUT_DEVICES = true เพื่อเทสต่อเนื่องโดยไม่ขึ้น maintenance)
      if (!DEVICE_CHECK.ALLOW_TEST_WITHOUT_DEVICES) {
        if (
          (isConfiguredCamera && !cameraConnected) ||
          (isConfiguredPrinter && !printerConnected)
        ) {
          if (onMaintenanceNeeded) onMaintenanceNeeded();
        }
      }

      prevStateRef.current = currentState;
      return;
    }

    // --- Transition detection ---
    if (prevState) {
      // Camera disconnect transition
      if (
        isConfiguredCamera &&
        prevState.cameraConnected &&
        !cameraConnected &&
        !alertSentRef.current.camera
      ) {
        alertSentRef.current.camera = true;
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const available = devices
            .filter((d) => d.kind === "videoinput")
            .map((d) => d.label || d.deviceId);
          await invoke("send_device_alert", {
            deviceType: "camera",
            deviceName: cameraName,
            availableDevices: available,
          });
        } catch {
          /* ignore */
        }
        logError(
          "camera_disconnect",
          `Camera disconnected: ${cameraName}`,
          undefined,
          "critical"
        );
        if (!DEVICE_CHECK.ALLOW_TEST_WITHOUT_DEVICES && onMaintenanceNeeded) onMaintenanceNeeded();
      }

      // Camera reconnect transition
      if (
        isConfiguredCamera &&
        !prevState.cameraConnected &&
        cameraConnected
      ) {
        alertSentRef.current.camera = false;
        try {
          await invoke("send_device_reconnected", {
            deviceType: "camera",
            deviceName: cameraName,
          });
        } catch {
          /* ignore */
        }
      }

      // Printer disconnect transition — ใช้ debounce เพื่อกรอง DS-RX1 brief re-enum (2-3 วิ)
      if (
        isConfiguredPrinter &&
        prevState.printerConnected &&
        !printerConnected &&
        !alertSentRef.current.printer &&
        !printerDisconnectTimerRef.current
      ) {
        const capturedPrinterName = printerName;
        const capturedAvailableNames = [...availablePrinterNames];
        const capturedPrinterStatus = printerLastStatus;
        appLogger.info(CTX, `[useDeviceCheck] Printer disconnected (status: ${capturedPrinterStatus}), waiting ${PRINTER_DISCONNECT_DEBOUNCE_MS}ms to confirm...`);
        printerDisconnectTimerRef.current = setTimeout(async () => {
          printerDisconnectTimerRef.current = null;
          // ตรวจจับอีกครั้ง — ถ้ายังหลุดอยู่ค่อยส่ง alert
          let stillDisconnected = true;
          let confirmedStatus = capturedPrinterStatus;
          try {
            const printers: any[] = await invoke("get_printers");
            const found = printers.find((p: any) => p.name === capturedPrinterName);
            stillDisconnected = !found?.is_online;
            if (found?.status) confirmedStatus = found.status;
          } catch {
            // ถ้า check ไม่ได้ถือว่ายังหลุด
          }
          if (stillDisconnected) {
            alertSentRef.current.printer = true;
            try {
              await invoke("send_device_alert", {
                deviceType: "printer",
                deviceName: capturedPrinterName,
                availableDevices: capturedAvailableNames,
                deviceStatus: confirmedStatus || undefined,
              });
            } catch { /* ignore */ }
            logError(
              "printer_disconnect",
              `Printer disconnected: ${capturedPrinterName} (status: ${confirmedStatus})`,
              undefined,
              "critical"
            );
            if (!DEVICE_CHECK.ALLOW_TEST_WITHOUT_DEVICES && onMaintenanceNeeded) onMaintenanceNeeded();
          } else {
            appLogger.info(CTX, "[useDeviceCheck] Printer reconnected within debounce window, ignoring transient disconnect");
          }
        }, PRINTER_DISCONNECT_DEBOUNCE_MS);
      }

      // Printer reconnect transition
      if (
        isConfiguredPrinter &&
        !prevState.printerConnected &&
        printerConnected
      ) {
        if (printerDisconnectTimerRef.current) {
          // Reconnect มาภายใน debounce window = DS-RX1 brief re-enum
          // ยกเลิก timer เงียบๆ ไม่ยิง reconnect noti (เพราะไม่เคยยิง disconnect)
          clearTimeout(printerDisconnectTimerRef.current);
          printerDisconnectTimerRef.current = null;
          appLogger.info(CTX, "[useDeviceCheck] Printer back within debounce window — transient disconnect ignored");
        } else {
          // alert disconnect ถูกส่งไปแล้ว → ส่ง reconnect notification
          alertSentRef.current.printer = false;
          try {
            await invoke("send_device_reconnected", {
              deviceType: "printer",
              deviceName: `Main: ${printerName}`,
            });
          } catch { /* ignore */ }
        }
      }
    }

    // เมื่ออุปกรณ์ที่ตั้งค่าไว้ยังหลุดอยู่ ให้แจ้ง maintenance
    // (printer: รอ debounce ผ่านก่อน เพื่อไม่โชว์ overlay จาก DS-RX1 brief re-enum)
    if (!DEVICE_CHECK.ALLOW_TEST_WITHOUT_DEVICES) {
      const printerReallyDisconnected = isConfiguredPrinter && !printerConnected && !printerDisconnectTimerRef.current;
      if (
        (isConfiguredCamera && !cameraConnected) ||
        printerReallyDisconnected
      ) {
        if (onMaintenanceNeeded) onMaintenanceNeeded();
      }
    }

    prevStateRef.current = currentState;
  }, [enabled, intervalMs, onMaintenanceNeeded, sendStartupReport]);

  useEffect(() => {
    if (!enabled) return;
    checkDevices();
    const timer = setInterval(checkDevices, intervalMs);

    // Listen for USB device changes (immediate detection on hot-plug/unplug)
    // This fires for webcams, printers, and other USB devices
    const handleDeviceChange = () => {
      appLogger.info(CTX, "[useDeviceCheck] USB device change detected, checking devices...");
      // Small delay to let Windows settle after USB event
      setTimeout(checkDevices, 1000);
    };
    try {
      navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    } catch {
      // mediaDevices not available — fall back to polling only
    }

    return () => {
      clearInterval(timer);
      if (printerDisconnectTimerRef.current) {
        clearTimeout(printerDisconnectTimerRef.current);
        printerDisconnectTimerRef.current = null;
      }
      try {
        navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
      } catch {
        // ignore
      }
    };
  }, [enabled, intervalMs, checkDevices]);
}

export default useDeviceCheck;

