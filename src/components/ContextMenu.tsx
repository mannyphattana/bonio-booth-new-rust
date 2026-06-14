import { useState, useEffect } from "react";
import { appLogger } from "../utils/appLogger";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import CameraConfigModal from "./CameraConfigModal";
import PrinterConfigModal from "./PrinterConfigModal";
import PaperPositionModal from "./PaperPositionModal";
import { clearPaperConfigs } from "../utils/paperStore";
import {
  DEFAULT_CLOSE_APP_PIN,
  DEFAULT_MENU_PIN,
  getCloseAppPin,
  getMenuPin,
  setCloseAppPin,
  setMenuPin,
} from "../config/appConfig";

interface Props {
  open: boolean;
  onClose: () => void;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
  onMirrorModeChange?: (enabled: boolean) => void;
}

export default function ContextMenu({
  open,
  onClose,
  onFormatReset,
  // onBeforeClose,
  onMirrorModeChange,
}: Props) {
  const navigate = useNavigate();
  const [activeModal, setActiveModal] = useState<
    "camera" | "printer" | "paper" | "pin" | null
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

  const [menuPin, setMenuPinState] = useState(DEFAULT_MENU_PIN);
  const [closeAppPin, setCloseAppPinState] = useState(DEFAULT_CLOSE_APP_PIN);

  const [pinChangeStep, setPinChangeStep] = useState<"enter" | "confirm">("enter");
  const [pinDraftInput, setPinDraftInput] = useState("");
  const [pinConfirmInput, setPinConfirmInput] = useState("");
  const [pinFirstValue, setPinFirstValue] = useState("");
  const [pinChangeError, setPinChangeError] = useState("");
  const [pinChangeSuccess, setPinChangeSuccess] = useState("");

  const [cameraStatus, setCameraStatus] = useState("");
  const [printerStatus, setPrinterStatus] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [mirrorMode, setMirrorModeState] = useState(() => localStorage.getItem("mirrorMode") !== "false");
  const [cameraIsCanon, setCameraIsCanon] = useState(() => (localStorage.getItem("cameraType") || "webcam") === "canon");

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
    setPinChangeStep("enter");
    setPinDraftInput("");
    setPinConfirmInput("");
    setPinFirstValue("");
    setPinChangeError("");
    setPinChangeSuccess("");
    setMenuPinState(getMenuPin());
    setCloseAppPinState(getCloseAppPin());

    // Get app version
    getVersion().then(v => setAppVersion(v)).catch((e) => appLogger.error("[ContextMenu]", `getVersion error: ${e}`));

    // Camera status
    const cameraType = localStorage.getItem("cameraType") || "webcam";
    setCameraIsCanon(cameraType === "canon");
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

    // Mirror mode
    setMirrorModeState(localStorage.getItem("mirrorMode") !== "false");
  }, [open]);

  const handleFormatReset = async () => {
    // Clear all config from localStorage
    localStorage.removeItem("machineId");
    localStorage.removeItem("machinePort");
    localStorage.removeItem("cameraType");
    localStorage.removeItem("selectedWebcamId");
    localStorage.removeItem("selectedCameraLabel");
    localStorage.removeItem("selectedCameraName");
    localStorage.removeItem("selectedPrinter");
    localStorage.removeItem("paperConfig");
    localStorage.removeItem("mirrorMode");
    // Clear paper config from persistent store
    await clearPaperConfigs().catch(() => {});

    onFormatReset();
    onClose();
  };

  const handleCloseApp = async () => {
    try {
      // ส่ง session log ก่อน exit เสมอ
      const { sendSessionLog } = await import("../utils/sessionManager");
      await sendSessionLog("user_exit");
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
    if (unlockPinInput.length >= menuPin.length) return;
    const next = unlockPinInput + key;
    setUnlockPinInput(next);
    
    if (next.length === menuPin.length) {
      if (next === menuPin) {
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
    if (pinInput.length >= closeAppPin.length) return;
    const next = pinInput + key;
    setPinInput(next);
    if (next.length === closeAppPin.length) {
      if (next === closeAppPin) {
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

  const resetPinChangeState = () => {
    setPinChangeStep("enter");
    setPinDraftInput("");
    setPinConfirmInput("");
    setPinFirstValue("");
    setPinChangeError("");
    setPinChangeSuccess("");
  };

  const closePinChangeModal = () => {
    resetPinChangeState();
    setActiveModal(null);
  };

  const handleChangePinKey = (key: string) => {
    if (pinChangeSuccess) return;
    if (key === "del") {
      if (pinChangeStep === "enter") {
        setPinDraftInput((p) => p.slice(0, -1));
      } else {
        setPinConfirmInput((p) => p.slice(0, -1));
      }
      setPinChangeError("");
      return;
    }

    const currentInput = pinChangeStep === "enter" ? pinDraftInput : pinConfirmInput;
    if (currentInput.length >= 4) return;

    const next = currentInput + key;
    if (pinChangeStep === "enter") {
      setPinDraftInput(next);
      if (next.length === 4) {
        setPinFirstValue(next);
        setPinChangeStep("confirm");
        setPinConfirmInput("");
      }
      return;
    }

    setPinConfirmInput(next);
    if (next.length === 4) {
      if (next === pinFirstValue) {
        setMenuPin(next);
        setCloseAppPin(next);
        setMenuPinState(next);
        setCloseAppPinState(next);
        setPinChangeSuccess("บันทึก PIN ใหม่สำเร็จ (ใช้ทั้งเข้าเมนูและปิดแอป)");
        setPinChangeError("");
      } else {
        setPinChangeError("PIN ไม่ตรงกัน กรุณาลองใหม่");
        setPinDraftInput("");
        setPinConfirmInput("");
        setPinFirstValue("");
        setPinChangeStep("enter");
      }
    }
  };

  // Keyboard support for PIN modals
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (activeModal === "pin") {
        if (e.key >= "0" && e.key <= "9") handleChangePinKey(e.key);
        else if (e.key === "Backspace") handleChangePinKey("del");
        else if (e.key === "Escape") closePinChangeModal();
        return;
      }

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
  }, [activeModal, showPinModal, isMenuUnlocked, open, unlockPinInput, pinInput, pinChangeStep, pinDraftInput, pinConfirmInput, pinChangeSuccess]);

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
            {Array.from({ length: menuPin.length }).map((_, i) => (
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
            {Array.from({ length: closeAppPin.length }).map((_, i) => (
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

  if (activeModal === "pin") {
    const dotsLength = 4;
    const currentInput = pinChangeStep === "enter" ? pinDraftInput : pinConfirmInput;

    return (
      <div
        className="context-menu-overlay"
        onClick={(e) => {
          e.stopPropagation();
          closePinChangeModal();
        }}
      >
        <div className="context-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 340, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px" }}>🔐 เปลี่ยน PIN</h3>

          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {pinChangeStep === "enter"
              ? "กรอก PIN ใหม่ (4 หลัก)"
              : "ยืนยัน PIN อีกครั้ง"}
          </p>

          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 16 }}>
            {Array.from({ length: dotsLength }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: i < currentInput.length ? (pinChangeError ? "#ff4444" : "#fff") : "#555",
                  transition: "background 0.15s",
                }}
              />
            ))}
          </div>

          {pinChangeError && (
            <p style={{ color: "#ff4444", fontSize: 13, marginBottom: 10 }}>{pinChangeError}</p>
          )}
          {pinChangeSuccess && (
            <p style={{ color: "#4cd964", fontSize: 13, marginBottom: 10 }}>{pinChangeSuccess}</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {PAD.flat().map((key, i) => (
              key === "" ? <div key={i} /> :
              <button
                key={i}
                onClick={() => handleChangePinKey(key)}
                disabled={!!pinChangeSuccess}
                style={{
                  padding: "16px 0",
                  fontSize: key === "del" ? 18 : 24,
                  fontWeight: 600,
                  borderRadius: 12,
                  border: "none",
                  background: key === "del" ? "#444" : "#2a2a2a",
                  color: "#fff",
                  cursor: pinChangeSuccess ? "not-allowed" : "pointer",
                  opacity: pinChangeSuccess ? 0.5 : 1,
                }}
              >
                {key === "del" ? "⌫" : key}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="context-menu-item"
              style={{ justifyContent: "center", background: "#333", flex: 1 }}
              onClick={closePinChangeModal}
            >
              ปิด
            </button>

            {pinChangeSuccess && (
              <button
                className="context-menu-item"
                style={{ justifyContent: "center", background: "#2f5f2f", flex: 1 }}
                onClick={closePinChangeModal}
              >
                เสร็จสิ้น
              </button>
            )}
          </div>
        </div>
      </div>
    );
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

        {/* 3. Mirror / Flip Mode (เฉพาะ Webcam — Canon ปิดใช้งานเพื่อรักษาคุณภาพ) */}
        <button
          className="context-menu-item context-menu-config-item"
          disabled={cameraIsCanon}
          onClick={() => {
            if (cameraIsCanon) return;
            const newValue = !mirrorMode;
            setMirrorModeState(newValue);
            localStorage.setItem("mirrorMode", String(newValue));
            onMirrorModeChange?.(newValue);
          }}
          style={cameraIsCanon ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
        >
          <span style={{ fontSize: 24 }}>🪞</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Mirror / Flip Mode</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {cameraIsCanon
                ? "ปิดใช้งานสำหรับ Canon (รักษาคุณภาพรูป)"
                : "เฉพาะ Webcam — รูป/วิดีโอที่บันทึก"}
            </div>
          </div>
          <div style={{
            padding: "4px 14px",
            borderRadius: 20,
            background: cameraIsCanon ? "#444" : (mirrorMode ? "#2a5f2a" : "#5f2a2a"),
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            minWidth: 44,
            textAlign: "center",
          }}>
            {cameraIsCanon ? "🔒" : (mirrorMode ? "ON" : "OFF")}
          </div>
        </button>

        {/* 4. Paper Position Config */}
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

        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("pin")}
        >
          <span style={{ fontSize: 24 }}>🔐</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>เปลี่ยน PIN</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              Menu PIN / Close App PIN
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
