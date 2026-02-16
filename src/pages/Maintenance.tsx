import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface DeviceStatus {
  cameraOk: boolean;
  printerOk: boolean;
  cameraName: string;
  printerName: string;
}

interface Props {
  onResolved: () => void;
  onOpenConfig: (type: "camera" | "printer") => void;
  lineUrl?: string;
  backgroundSecond?: string;
}

export default function Maintenance({ onResolved, onOpenConfig, lineUrl, backgroundSecond }: Props) {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>({
    cameraOk: false,
    printerOk: false,
    cameraName: "",
    printerName: "",
  });
  const [checking, setChecking] = useState(true);

  const checkDevices = useCallback(async () => {
    setChecking(true);
    let cameraOk = false;
    let printerOk = false;
    let cameraName = "";
    let printerName = "";

    // Check camera
    const cameraType = localStorage.getItem("cameraType") || "webcam";
    if (cameraType === "webcam") {
      const savedId = localStorage.getItem("selectedWebcamId");
      const savedLabel = localStorage.getItem("selectedCameraLabel");
      if (savedId) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const found = devices.find(
            (d) => d.kind === "videoinput" && d.deviceId === savedId
          );
          if (found) {
            cameraOk = true;
            cameraName = found.label || savedLabel || "Webcam";
          } else {
            cameraName = savedLabel || "Webcam (not found)";
          }
        } catch {
          cameraName = savedLabel || "Webcam (error)";
        }
      } else {
        cameraName = "ยังไม่ได้ตั้งค่า";
      }
    } else {
      // DSLR / Canon
      const savedName = localStorage.getItem("selectedCameraName");
      if (savedName) {
        try {
          const cameras: any[] = await invoke("list_dslr_cameras");
          const found = cameras.some((c: any) => c.name === savedName);
          if (found) {
            cameraOk = true;
            cameraName = savedName;
          } else {
            cameraName = `${savedName} (not found)`;
          }
        } catch {
          cameraName = `${savedName} (error)`;
        }
      } else {
        cameraName = "ยังไม่ได้ตั้งค่า";
      }
    }

    // Check printer
    const savedPrinter = localStorage.getItem("selectedPrinter");
    if (savedPrinter) {
      try {
        const printers: any[] = await invoke("get_printers");
        const found = printers.find((p: any) => p.name === savedPrinter);
        if (found) {
          printerOk = true;
          printerName = savedPrinter;
        } else {
          printerName = `${savedPrinter} (not found)`;
        }
      } catch {
        printerName = `${savedPrinter} (error)`;
      }
    } else {
      printerName = "ยังไม่ได้ตั้งค่า";
    }

    setDeviceStatus({ cameraOk, printerOk, cameraName, printerName });
    setChecking(false);

    // If both are OK, auto-resolve
    if (cameraOk && printerOk) {
      onResolved();
    }
  }, [onResolved]);

  // Poll every 3 seconds
  useEffect(() => {
    checkDevices();
    const timer = setInterval(checkDevices, 3000);
    return () => clearInterval(timer);
  }, [checkDevices]);

  return (
    <div style={{
      ...styles.container,
      ...(backgroundSecond ? {
        backgroundImage: `url(${backgroundSecond})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } : {}),
    }}>
      <div style={styles.content}>
        {/* Warning icon */}
        <div style={styles.iconWrapper}>
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2L1 21h22L12 2z"
              fill="#FF6B35"
              stroke="#FF6B35"
              strokeWidth="0.5"
            />
            <text
              x="12"
              y="18"
              textAnchor="middle"
              fontSize="12"
              fontWeight="bold"
              fill="white"
            >
              !
            </text>
          </svg>
        </div>

        <h1 style={styles.title}>SYSTEM MAINTENANCE</h1>
        <p style={styles.subtitle}>ระบบอยู่ระหว่างการซ่อมบำรุง</p>

        <p style={styles.instruction}>
          กรุณาตรวจสอบอุปกรณ์ ด้านล่าง หรือติดต่อพนักงาน
        </p>

        {/* Device status cards */}
        <div style={styles.deviceCards}>
          {/* Camera status */}
          <div
            style={{
              ...styles.deviceCard,
              borderColor: deviceStatus.cameraOk ? "#4CAF50" : "#f44336",
            }}
          >
            <div style={styles.deviceHeader}>
              <span style={styles.deviceIcon}>📷</span>
              <span style={styles.deviceLabel}>กล้อง (Camera)</span>
              <span
                style={{
                  ...styles.statusBadge,
                  background: deviceStatus.cameraOk ? "#4CAF50" : "#f44336",
                }}
              >
                {checking ? "..." : deviceStatus.cameraOk ? "OK" : "NOT FOUND"}
              </span>
            </div>
            <div style={styles.deviceDetail}>{deviceStatus.cameraName}</div>
            <button
              style={styles.configButton}
              onClick={() => onOpenConfig("camera")}
            >
              ตั้งค่ากล้องใหม่
            </button>
          </div>

          {/* Printer status */}
          <div
            style={{
              ...styles.deviceCard,
              borderColor: deviceStatus.printerOk ? "#4CAF50" : "#f44336",
            }}
          >
            <div style={styles.deviceHeader}>
              <span style={styles.deviceIcon}>🖨️</span>
              <span style={styles.deviceLabel}>เครื่องปริ้น (Printer)</span>
              <span
                style={{
                  ...styles.statusBadge,
                  background: deviceStatus.printerOk ? "#4CAF50" : "#f44336",
                }}
              >
                {checking ? "..." : deviceStatus.printerOk ? "OK" : "NOT FOUND"}
              </span>
            </div>
            <div style={styles.deviceDetail}>{deviceStatus.printerName}</div>
            <button
              style={styles.configButton}
              onClick={() => onOpenConfig("printer")}
            >
              ตั้งค่าเครื่องปริ้นใหม่
            </button>
          </div>
        </div>

        {/* LINE QR code */}
        {lineUrl && (
          <div style={styles.qrSection}>
            <p style={styles.qrLabel}>แจ้งปัญหาผ่าน LINE</p>
            <div style={styles.qrBox}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(lineUrl)}`}
                alt="LINE QR"
                width={180}
                height={180}
                style={{ borderRadius: 8 }}
              />
            </div>
          </div>
        )}

        <p style={styles.footerNote}>
          {deviceStatus.cameraOk && deviceStatus.printerOk
            ? "✅ อุปกรณ์พร้อมใช้งานแล้ว กำลังกลับหน้าหลัก..."
            : "⏳ ระบบกำลังตรวจสอบอุปกรณ์อัตโนมัติ..."}
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    background: "#1a1a2e",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99999,
    color: "#fff",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "40px 30px",
    maxWidth: 600,
    width: "100%",
  },
  iconWrapper: {
    marginBottom: 20,
  },
  title: {
    fontSize: "2.8rem",
    fontWeight: 700,
    margin: "0 0 8px 0",
    letterSpacing: 2,
    color: "#FF6B35",
  },
  subtitle: {
    fontSize: "1.4rem",
    margin: "0 0 20px 0",
    color: "#ccc",
  },
  instruction: {
    fontSize: "1.2rem",
    margin: "0 0 30px 0",
    color: "#aaa",
    lineHeight: 1.6,
  },
  deviceCards: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    marginBottom: 30,
  },
  deviceCard: {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    padding: "20px 24px",
    border: "2px solid",
    textAlign: "left",
  },
  deviceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  deviceIcon: {
    fontSize: "1.6rem",
  },
  deviceLabel: {
    fontSize: "1.1rem",
    fontWeight: 600,
    flex: 1,
  },
  statusBadge: {
    fontSize: "0.8rem",
    fontWeight: 700,
    padding: "4px 12px",
    borderRadius: 20,
    color: "#fff",
    letterSpacing: 1,
  },
  deviceDetail: {
    fontSize: "0.95rem",
    color: "#aaa",
    marginLeft: 40,
  },
  configButton: {
    marginTop: 12,
    marginLeft: 40,
    padding: "10px 20px",
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#fff",
    background: "#FF6B35",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
  },
  qrSection: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 20,
  },
  qrLabel: {
    fontSize: "1rem",
    color: "#aaa",
    marginBottom: 10,
  },
  qrBox: {
    background: "#fff",
    padding: 12,
    borderRadius: 12,
  },
  footerNote: {
    fontSize: "1rem",
    color: "#888",
    marginTop: 10,
  },
};
