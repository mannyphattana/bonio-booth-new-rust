import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isPrinting } from "../utils/printingState";
import { DEVICE_CHECK } from "../config/appConfig";

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
    
    // Check printing state first - if printing, skip printer status check to avoid false notifications
    const printingState = isPrinting();
    if (printingState && isConfiguredPrinter) {
      console.log("[useDeviceCheck] Printer is printing or in grace period, skipping printer status check");
      // Keep previous printer connected state to avoid false transitions
      if (prevStateRef.current) {
        printerConnected = prevStateRef.current.printerConnected;
        console.log(`[useDeviceCheck] Using previous printer state: ${printerConnected}`);
      } else {
        printerConnected = true; // Assume connected during printing
        console.log("[useDeviceCheck] No previous state, assuming printer connected during printing");
      }
      // Get available printers for potential alert (but don't change connected state)
      try {
        const printers: any[] = await invoke("get_printers");
        availablePrinterNames = printers.map((p: any) => p.name);
      } catch {
        // Keep empty array if can't get printers
      }
    } else if (savedPrinter) {
      try {
        const printers: any[] = await invoke("get_printers");
        availablePrinterNames = printers.map((p: any) => p.name);
        // Check both name AND is_online — Get-Printer returns installed printers
        // even when physically unplugged, but WorkOffline flag changes to true
        const foundPrinter = printers.find((p: any) => p.name === savedPrinter);
        printerConnected = foundPrinter?.is_online || false;
        
        // Log printer status for debugging
        if (foundPrinter) {
          console.log(
            `[useDeviceCheck] Printer "${savedPrinter}": is_online=${foundPrinter.is_online}, status="${foundPrinter.status}"`,
          );
        } else {
          console.log(
            `[useDeviceCheck] Printer "${savedPrinter}": not found in printer list`,
          );
        }
      } catch (err) {
        console.error("[useDeviceCheck] Error checking printers:", err);
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

      // Printer disconnect transition
      if (
        isConfiguredPrinter &&
        prevState.printerConnected &&
        !printerConnected &&
        !alertSentRef.current.printer
      ) {
        alertSentRef.current.printer = true;
        try {
          await invoke("send_device_alert", {
            deviceType: "printer",
            deviceName: printerName,
            availableDevices: availablePrinterNames,
          });
        } catch {
          /* ignore */
        }
        if (!DEVICE_CHECK.ALLOW_TEST_WITHOUT_DEVICES && onMaintenanceNeeded) onMaintenanceNeeded();
      }

      // Printer reconnect transition
      if (
        isConfiguredPrinter &&
        !prevState.printerConnected &&
        printerConnected
      ) {
        alertSentRef.current.printer = false;
        try {
          await invoke("send_device_reconnected", {
            deviceType: "printer",
            deviceName: `Main: ${printerName}`,
          });
        } catch {
          /* ignore */
        }
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
      console.log("[useDeviceCheck] USB device change detected, checking devices...");
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
      try {
        navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
      } catch {
        // ignore
      }
    };
  }, [enabled, intervalMs, checkDevices]);
}

export default useDeviceCheck;
