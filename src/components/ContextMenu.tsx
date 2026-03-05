import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import CameraConfigModal from "./CameraConfigModal";
import PrinterConfigModal from "./PrinterConfigModal";
import PaperPositionModal from "./PaperPositionModal";
import { CLOSE_APP_PIN } from "../config/appConfig";

interface Props {
  open: boolean;
  onClose: () => void;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function ContextMenu({
  open,
  onClose,
  onFormatReset,
  // onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const [activeModal, setActiveModal] = useState<
    "camera" | "printer" | "paper" | null
  >(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  // State สำหรับรหัสปิดแอป (ของเดิม)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  // 🚨 State สำหรับรหัสผ่านเข้าเมนู (7053)
  const [isMenuUnlocked, setIsMenuUnlocked] = useState(false);
  const [unlockPinInput, setUnlockPinInput] = useState("");
  const [unlockPinError, setUnlockPinError] = useState(false);
  const MENU_PIN = "7053";

  const [cameraStatus, setCameraStatus] = useState("");
  const [printerStatus, setPrinterStatus] = useState("");
  const [appVersion, setAppVersion] = useState("");

  // Load status summaries when menu opens
  useEffect(() => {
    if (!open) return;
    setActiveModal(null);
    setShowResetConfirm(false);
    setShowPinModal(false);
    setPinInput("");
    setPinError(false);
    
    // 🚨 รีเซ็ตสถานะการล็อกทุกครั้งที่เปิดเมนูใหม่
    setIsMenuUnlocked(false);
    setUnlockPinInput("");
    setUnlockPinError(false);

    // Get app version
    getVersion().then(v => setAppVersion(v)).catch(console.error);

    // Camera status
    const cameraType = localStorage.getItem("cameraType") || "webcam";
    if (cameraType === "webcam") {
      const label = localStorage.getItem("selectedCameraLabel");
      setCameraStatus(label ? `Webcam: ${label}` : "Webcam (ยังไม่ได้เลือก)");
    } else {
      const name = localStorage.getItem("selectedCameraName");
      setCameraStatus(name ? `DSLR: ${name}` : "Canon/DSLR (ยังไม่ได้เลือก)");
    }

    // Printer status
    const printer = localStorage.getItem("selectedPrinter");
    setPrinterStatus(printer || "ยังไม่ได้เลือก");
  }, [open]);

  const handleFormatReset = () => {
    // Clear all config from localStorage
    localStorage.removeItem("machineId");
    localStorage.removeItem("machinePort");
    localStorage.removeItem("cameraType");
    localStorage.removeItem("selectedWebcamId");
    localStorage.removeItem("selectedCameraLabel");
    localStorage.removeItem("selectedCameraName");
    localStorage.removeItem("selectedPrinter");
    localStorage.removeItem("paperConfig");
    localStorage.removeItem("paperConfigPortrait");
    localStorage.removeItem("paperConfigLandscape");

    onFormatReset();
    onClose();
  };

  const handleCloseApp = async () => {
    try {
      await invoke("exit_app");
    } catch {
      window.close();
    }
  };

  // 🚨 ฟังก์ชันจัดการปุ่มกดรหัสสำหรับ "เข้าเมนู (7053)"
  const handleUnlockPinKey = (key: string) => {
    if (key === "del") {
      setUnlockPinInput((p) => p.slice(0, -1));
      setUnlockPinError(false);
      return;
    }
    if (unlockPinInput.length >= 4) return;
    const next = unlockPinInput + key;
    setUnlockPinInput(next);
    
    if (next.length === MENU_PIN.length) {
      if (next === MENU_PIN) {
        setIsMenuUnlocked(true);
      } else {
        setUnlockPinError(true);
        setTimeout(() => {
          setUnlockPinInput("");
          setUnlockPinError(false);
        }, 800);
      }
    }
  };

  // ฟังก์ชันจัดการปุ่มกดรหัสสำหรับ "ปิดแอป"
  const handlePinKey = (key: string) => {
    if (key === "del") {
      setPinInput((p) => p.slice(0, -1));
      setPinError(false);
      return;
    }
    if (pinInput.length >= 6) return;
    const next = pinInput + key;
    setPinInput(next);
    if (next.length === CLOSE_APP_PIN.length) {
      if (next === CLOSE_APP_PIN) {
        setShowPinModal(false);
        setPinInput("");
        setPinError(false);
        handleCloseApp();
      } else {
        setPinError(true);
        setTimeout(() => {
          setPinInput("");
          setPinError(false);
        }, 800);
      }
    }
  };

  // Keyboard support for PIN modals
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // โหมดกดรหัสปิดแอป
      if (showPinModal) {
        if (e.key >= "0" && e.key <= "9") handlePinKey(e.key);
        else if (e.key === "Backspace") handlePinKey("del");
        else if (e.key === "Escape") {
          setShowPinModal(false);
          setPinInput("");
          setPinError(false);
        }
      } 
      // โหมดกดรหัสเข้าเมนู (ยังไม่ปลดล็อก)
      else if (!isMenuUnlocked) {
        if (e.key >= "0" && e.key <= "9") handleUnlockPinKey(e.key);
        else if (e.key === "Backspace") handleUnlockPinKey("del");
        else if (e.key === "Escape") onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPinModal, isMenuUnlocked, open, unlockPinInput, pinInput]);

  if (!open) return null;

  const PAD = [["1","2","3"],["4","5","6"],["7","8","9"],["del","0",""]];

  // 🚨 ด่านตรวจที่ 1: ถ้ายังไม่ได้ปลดล็อกรหัส 7053 ให้แสดงหน้าต่างนี้ขวางไว้
  if (!isMenuUnlocked) {
    return (
      <div
        className="context-menu-overlay"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <div className="context-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px" }}>🔒 รหัสผ่านตั้งค่า</h3>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>กรอกรหัสผ่านเพื่อเข้าสู่เมนูผู้ดูแล</p>

          {/* Dots */}
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 16 }}>
            {Array.from({ length: MENU_PIN.length }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: i < unlockPinInput.length
                    ? (unlockPinError ? "#ff4444" : "#fff")
                    : "#555",
                  transition: "background 0.15s",
                }}
              />
            ))}
          </div>

          {unlockPinError && (
            <p style={{ color: "#ff4444", fontSize: 13, marginBottom: 10 }}>รหัสไม่ถูกต้อง</p>
          )}

          {/* Numpad */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {PAD.flat().map((key, i) => (
              key === "" ? <div key={i} /> :
              <button
                key={i}
                onClick={() => handleUnlockPinKey(key)}
                style={{
                  padding: "16px 0",
                  fontSize: key === "del" ? 18 : 24,
                  fontWeight: 600,
                  borderRadius: 12,
                  border: "none",
                  background: key === "del" ? "#444" : "#2a2a2a",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                {key === "del" ? "⌫" : key}
              </button>
            ))}
          </div>

          <button
            className="context-menu-item"
            style={{ marginTop: 16, justifyContent: "center", background: "#333" }}
            onClick={onClose}
          >
            ยกเลิก
          </button>
        </div>
      </div>
    );
  }

  // ด่านตรวจที่ 2: PIN modal สำหรับยืนยันการ "ปิดแอป" (ของเดิม)
  if (showPinModal) {
    return (
      <div
        className="context-menu-overlay"
        onClick={(e) => { e.stopPropagation(); setShowPinModal(false); setPinInput(""); setPinError(false); }}
      >
        <div className="context-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px" }}>🔒 ยืนยันรหัสก่อนปิดแอป</h3>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>Enter PIN to close the app</p>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 16 }}>
            {Array.from({ length: CLOSE_APP_PIN.length }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: i < pinInput.length ? (pinError ? "#ff4444" : "#fff") : "#555",
                  transition: "background 0.15s",
                }}
              />
            ))}
          </div>

          {pinError && <p style={{ color: "#ff4444", fontSize: 13, marginBottom: 10 }}>รหัสไม่ถูกต้อง</p>}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {PAD.flat().map((key, i) => (
              key === "" ? <div key={i} /> :
              <button
                key={i}
                onClick={() => handlePinKey(key)}
                style={{
                  padding: "16px 0", fontSize: key === "del" ? 18 : 24, fontWeight: 600,
                  borderRadius: 12, border: "none", background: key === "del" ? "#444" : "#2a2a2a",
                  color: "#fff", cursor: "pointer",
                }}
              >
                {key === "del" ? "⌫" : key}
              </button>
            ))}
          </div>

          <button
            className="context-menu-item"
            style={{ marginTop: 16, justifyContent: "center", background: "#333" }}
            onClick={() => { setShowPinModal(false); setPinInput(""); setPinError(false); }}
          >
            ยกเลิก
          </button>
        </div>
      </div>
    );
  }

  // If a sub-modal is active, show it instead
  if (activeModal === "camera") {
    return <CameraConfigModal open={true} onClose={() => setActiveModal(null)} />;
  }

  if (activeModal === "printer") {
    return <PrinterConfigModal open={true} onClose={() => setActiveModal(null)} />;
  }

  if (activeModal === "paper") {
    return <PaperPositionModal open={true} onClose={() => setActiveModal(null)} />;
  }

  // หน้าจอเมนูหลัก (แสดงเมื่อกรอกรหัส 7053 ผ่านแล้ว)
  return (
    <div
      className="context-menu-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="context-menu" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>⚙️ Settings</h3>
          {appVersion && (
            <span style={{ fontSize: 12, color: "#888", background: "#222", padding: "2px 8px", borderRadius: 12 }}>
              v{appVersion}
            </span>
          )}
        </div>

        {/* 1. Camera Config */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("camera")}
        >
          <span style={{ fontSize: 24 }}>📷</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Camera Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {cameraStatus}
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>›</span>
        </button>

        {/* 2. Printer Config */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("printer")}
        >
          <span style={{ fontSize: 24 }}>🖨️</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Printer Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {printerStatus}
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>›</span>
        </button>

        {/* 3. Paper Position Config */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("paper")}
        >
          <span style={{ fontSize: 24 }}>📄</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Paper Position Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              ปรับ Scale, Vertical, Horizontal
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>›</span>
        </button>

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        {/* 4. Request Image (พิมพ์ย้อนหลัง) */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => {
            onClose();
            navigate("/request-image");
          }}
        >
          <span style={{ fontSize: 24 }}>🖼️</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>พิมพ์ย้อนหลัง</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              Request Image Print
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>›</span>
        </button>

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        {/* 5. Format Reset */}
        {!showResetConfirm ? (
          <button
            className="context-menu-item"
            style={{ justifyContent: "center", color: "#ffa502" }}
            onClick={() => setShowResetConfirm(true)}
          >
            🔄 Format Reset
          </button>
        ) : (
          <div className="context-menu-confirm-box">
            <p style={{ fontSize: 13, marginBottom: 8, textAlign: "center" }}>
              ⚠️ ต้องการล้างค่าทั้งหมดและตั้งค่า Machine ใหม่?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="context-menu-confirm-cancel"
                onClick={() => setShowResetConfirm(false)}
              >
                ยกเลิก
              </button>
              <button
                className="context-menu-confirm-ok"
                onClick={handleFormatReset}
              >
                ยืนยัน Reset
              </button>
            </div>
          </div>
        )}

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        {/* Close App */}
        <button
          className="context-menu-item"
          style={{ justifyContent: "center", color: "#ff4444" }}
          onClick={() => { setShowPinModal(true); setPinInput(""); setPinError(false); }}
        >
          ❌ ปิดแอป / Close App
        </button>

        <button
          className="context-menu-item"
          style={{
            marginTop: 8,
            justifyContent: "center",
            background: "#333",
          }}
          onClick={onClose}
        >
          Close Menu
        </button>
      </div>
    </div>
  );
}