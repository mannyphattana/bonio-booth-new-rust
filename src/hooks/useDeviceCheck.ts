import { useEffect, useRef, useCallback } from "react";
import { appLogger } from "../utils/appLogger";
import { invoke } from "@tauri-apps/api/core";
import { DEVICE_CHECK } from "../config/appConfig";
import { logError } from "../utils/logger";

// DS-RX1 à¹à¸¥à¸° printer à¸šà¸²à¸‡à¸£à¸¸à¹ˆà¸™à¸ˆà¸° re-enumerate USB à¸Šà¸±à¹ˆà¸§à¸„à¸£à¸²à¸§ (2-3 à¸§à¸´) à¸£à¸°à¸«à¸§à¹ˆà¸²à¸‡ wakeup/ribbon load
// à¹ƒà¸Šà¹‰ debounce à¸à¹ˆà¸­à¸™à¸¢à¸´à¸‡ alert à¹€à¸žà¸·à¹ˆà¸­à¸à¸£à¸­à¸‡ false disconnect à¸­à¸­à¸
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
  // Debounce timer à¸ªà¸³à¸«à¸£à¸±à¸š printer disconnect
  // à¸–à¹‰à¸² printer reconnect à¸à¹ˆà¸­à¸™ timer à¸¢à¸´à¸‡ = brief re-enum â†’ à¸¢à¸à¹€à¸¥à¸´à¸ alert
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

        if (foundPrinter) {
          appLogger.info(__CTX__, 
            `[useDeviceCheck] Printer "${savedPrinter}": is_online=${foundPrinter.is_online}, status="${foundPrinter.status}"`,
          );
        } else {
          appLogger.info(__CTX__, 
            `[useDeviceCheck] Printer "${savedPrinter}": not found in printer list`,
          );
        }
      } catch (err) {
        appLogger.error(__CTX__, "[useDeviceCheck] Error checking printers:", err);
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
            cameraDeviceName: cameraName || "à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²",
            printerConfigured: isConfiguredPrinter,
            printerFound: printerConnected,
            printerDeviceDetail: printerName ? `Main: ${printerName}` : "à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²",
            printerAvailableNames: availablePrinterNames,
          });
        } catch {
          /* ignore startup report errors */
        }
      }

      // If either device is configured but not found on startup â†’ maintenance
      // (à¸‚à¹‰à¸²à¸¡à¸–à¹‰à¸² ALLOW_TEST_WITHOUT_DEVICES = true à¹€à¸žà¸·à¹ˆà¸­à¹€à¸—à¸ªà¸•à¹ˆà¸­à¹€à¸™à¸·à¹ˆà¸­à¸‡à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸‚à¸¶à¹‰à¸™ maintenance)
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

      // Printer disconnect transition â€” à¹ƒà¸Šà¹‰ debounce à¹€à¸žà¸·à¹ˆà¸­à¸à¸£à¸­à¸‡ DS-RX1 brief re-enum (2-3 à¸§à¸´)
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
        appLogger.info(__CTX__, `[useDeviceCheck] Printer disconnected (status: ${capturedPrinterStatus}), waiting ${PRINTER_DISCONNECT_DEBOUNCE_MS}ms to confirm...`);
        printerDisconnectTimerRef.current = setTimeout(async () => {
          printerDisconnectTimerRef.current = null;
          // à¸•à¸£à¸§à¸ˆà¸ˆà¸±à¸šà¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡ â€” à¸–à¹‰à¸²à¸¢à¸±à¸‡à¸«à¸¥à¸¸à¸”à¸­à¸¢à¸¹à¹ˆà¸„à¹ˆà¸­à¸¢à¸ªà¹ˆà¸‡ alert
          let stillDisconnected = true;
          let confirmedStatus = capturedPrinterStatus;
          try {
            const printers: any[] = await invoke("get_printers");
            const found = printers.find((p: any) => p.name === capturedPrinterName);
            stillDisconnected = !found?.is_online;
            if (found?.status) confirmedStatus = found.status;
          } catch {
            // à¸–à¹‰à¸² check à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸–à¸·à¸­à¸§à¹ˆà¸²à¸¢à¸±à¸‡à¸«à¸¥à¸¸à¸”
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
            appLogger.info(__CTX__, "[useDeviceCheck] Printer reconnected within debounce window, ignoring transient disconnect");
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
          // Reconnect à¸¡à¸²à¸ à¸²à¸¢à¹ƒà¸™ debounce window = DS-RX1 brief re-enum
          // à¸¢à¸à¹€à¸¥à¸´à¸ timer à¹€à¸‡à¸µà¸¢à¸šà¹† à¹„à¸¡à¹ˆà¸¢à¸´à¸‡ reconnect noti (à¹€à¸žà¸£à¸²à¸°à¹„à¸¡à¹ˆà¹€à¸„à¸¢à¸¢à¸´à¸‡ disconnect)
          clearTimeout(printerDisconnectTimerRef.current);
          printerDisconnectTimerRef.current = null;
          appLogger.info(__CTX__, "[useDeviceCheck] Printer back within debounce window â€” transient disconnect ignored");
        } else {
          // alert disconnect à¸–à¸¹à¸à¸ªà¹ˆà¸‡à¹„à¸›à¹à¸¥à¹‰à¸§ â†’ à¸ªà¹ˆà¸‡ reconnect notification
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

    // à¹€à¸¡à¸·à¹ˆà¸­à¸­à¸¸à¸›à¸à¸£à¸“à¹Œà¸—à¸µà¹ˆà¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹„à¸§à¹‰à¸¢à¸±à¸‡à¸«à¸¥à¸¸à¸”à¸­à¸¢à¸¹à¹ˆ à¹ƒà¸«à¹‰à¹à¸ˆà¹‰à¸‡ maintenance
    // (printer: à¸£à¸­ debounce à¸œà¹ˆà¸²à¸™à¸à¹ˆà¸­à¸™ à¹€à¸žà¸·à¹ˆà¸­à¹„à¸¡à¹ˆà¹‚à¸Šà¸§à¹Œ overlay à¸ˆà¸²à¸ DS-RX1 brief re-enum)
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
      appLogger.info(__CTX__, "[useDeviceCheck] USB device change detected, checking devices...");
      // Small delay to let Windows settle after USB event
      setTimeout(checkDevices, 1000);
    };
    try {
      navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);
    } catch {
      // mediaDevices not available â€” fall back to polling only
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

