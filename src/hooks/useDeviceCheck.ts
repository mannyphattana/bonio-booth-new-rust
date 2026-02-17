import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

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
    if (savedPrinter) {
      try {
        const printers: any[] = await invoke("get_printers");
        availablePrinterNames = printers.map((p: any) => p.name);
        // Check both name AND is_online — Get-Printer returns installed printers
        // even when physically unplugged, but WorkOffline flag changes to true
        printerConnected = printers.some(
          (p: any) => p.name === savedPrinter && p.is_online,
        );
      } catch {
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
      if (
        (isConfiguredCamera && !cameraConnected) ||
        (isConfiguredPrinter && !printerConnected)
      ) {
        if (onMaintenanceNeeded) onMaintenanceNeeded();
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
        if (onMaintenanceNeeded) onMaintenanceNeeded();
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
        if (onMaintenanceNeeded) onMaintenanceNeeded();
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
    return () => clearInterval(timer);
  }, [enabled, intervalMs, checkDevices]);
}

export default useDeviceCheck;
