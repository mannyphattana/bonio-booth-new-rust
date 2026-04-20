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
}

export default function ContextMenu({
  open,
  onClose,
  onFormatReset,
  // onBeforeClose,
}: Props) {
  const navigate = useNavigate();
  const [activeModal, setActiveModal] = useState<
    "camera" | "printer" | "paper" | "pin" | null
  >(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  
  // State à¸ªà¸³à¸«à¸£à¸±à¸šà¸£à¸«à¸±à¸ªà¸›à¸´à¸”à¹à¸­à¸› (à¸‚à¸­à¸‡à¹€à¸”à¸´à¸¡)
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  // ðŸš¨ State à¸ªà¸³à¸«à¸£à¸±à¸šà¸£à¸«à¸±à¸ªà¸œà¹ˆà¸²à¸™à¹€à¸‚à¹‰à¸²à¹€à¸¡à¸™à¸¹ (7053)
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

  // Load status summaries when menu opens
  useEffect(() => {
    if (!open) return;
    setActiveModal(null);
    setShowResetConfirm(false);
    setShowPinModal(false);
    setPinInput("");
    setPinError(false);
    
    // ðŸš¨ à¸£à¸µà¹€à¸‹à¹‡à¸•à¸ªà¸–à¸²à¸™à¸°à¸à¸²à¸£à¸¥à¹‡à¸­à¸à¸—à¸¸à¸à¸„à¸£à¸±à¹‰à¸‡à¸—à¸µà¹ˆà¹€à¸›à¸´à¸”à¹€à¸¡à¸™à¸¹à¹ƒà¸«à¸¡à¹ˆ
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
    if (cameraType === "webcam") {
      const label = localStorage.getItem("selectedCameraLabel");
      setCameraStatus(label ? `Webcam: ${label}` : "Webcam (à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸¥à¸·à¸­à¸)");
    } else {
      const name = localStorage.getItem("selectedCameraName");
      setCameraStatus(name ? `DSLR: ${name}` : "Canon/DSLR (à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸¥à¸·à¸­à¸)");
    }

    // Printer status
    const printer = localStorage.getItem("selectedPrinter");
    setPrinterStatus(printer || "à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¹€à¸¥à¸·à¸­à¸");
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
    // Clear paper config from persistent store
    await clearPaperConfigs().catch(() => {});

    onFormatReset();
    onClose();
  };

  const handleCloseApp = async () => {
    try {
      // à¸ªà¹ˆà¸‡ session log à¸à¹ˆà¸­à¸™ exit à¹€à¸ªà¸¡à¸­
      const { sendSessionLog } = await import("../utils/sessionManager");
      await sendSessionLog("user_exit");
      await invoke("exit_app");
    } catch {
      window.close();
    }
  };

  // ðŸš¨ à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¸ˆà¸±à¸”à¸à¸²à¸£à¸›à¸¸à¹ˆà¸¡à¸à¸”à¸£à¸«à¸±à¸ªà¸ªà¸³à¸«à¸£à¸±à¸š "à¹€à¸‚à¹‰à¸²à¹€à¸¡à¸™à¸¹ (7053)"
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

  // à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¸ˆà¸±à¸”à¸à¸²à¸£à¸›à¸¸à¹ˆà¸¡à¸à¸”à¸£à¸«à¸±à¸ªà¸ªà¸³à¸«à¸£à¸±à¸š "à¸›à¸´à¸”à¹à¸­à¸›"
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
        setPinChangeSuccess("à¸šà¸±à¸™à¸—à¸¶à¸ PIN à¹ƒà¸«à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ (à¹ƒà¸Šà¹‰à¸—à¸±à¹‰à¸‡à¹€à¸‚à¹‰à¸²à¹€à¸¡à¸™à¸¹à¹à¸¥à¸°à¸›à¸´à¸”à¹à¸­à¸›)");
        setPinChangeError("");
      } else {
        setPinChangeError("PIN à¹„à¸¡à¹ˆà¸•à¸£à¸‡à¸à¸±à¸™ à¸à¸£à¸¸à¸“à¸²à¸¥à¸­à¸‡à¹ƒà¸«à¸¡à¹ˆ");
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

      // à¹‚à¸«à¸¡à¸”à¸à¸”à¸£à¸«à¸±à¸ªà¸›à¸´à¸”à¹à¸­à¸›
      if (showPinModal) {
        if (e.key >= "0" && e.key <= "9") handlePinKey(e.key);
        else if (e.key === "Backspace") handlePinKey("del");
        else if (e.key === "Escape") {
          setShowPinModal(false);
          setPinInput("");
          setPinError(false);
        }
      } 
      // à¹‚à¸«à¸¡à¸”à¸à¸”à¸£à¸«à¸±à¸ªà¹€à¸‚à¹‰à¸²à¹€à¸¡à¸™à¸¹ (à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¸›à¸¥à¸”à¸¥à¹‡à¸­à¸)
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

  // ðŸš¨ à¸”à¹ˆà¸²à¸™à¸•à¸£à¸§à¸ˆà¸—à¸µà¹ˆ 1: à¸–à¹‰à¸²à¸¢à¸±à¸‡à¹„à¸¡à¹ˆà¹„à¸”à¹‰à¸›à¸¥à¸”à¸¥à¹‡à¸­à¸à¸£à¸«à¸±à¸ª 7053 à¹ƒà¸«à¹‰à¹à¸ªà¸”à¸‡à¸«à¸™à¹‰à¸²à¸•à¹ˆà¸²à¸‡à¸™à¸µà¹‰à¸‚à¸§à¸²à¸‡à¹„à¸§à¹‰
  if (!isMenuUnlocked) {
    return (
      <div
        className="context-menu-overlay"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
      >
        <div className="context-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px" }}>ðŸ”’ à¸£à¸«à¸±à¸ªà¸œà¹ˆà¸²à¸™à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²</h3>
          <p style={{ fontSize: 13, opacity: 0.6, marginBottom: 16 }}>à¸à¸£à¸­à¸à¸£à¸«à¸±à¸ªà¸œà¹ˆà¸²à¸™à¹€à¸žà¸·à¹ˆà¸­à¹€à¸‚à¹‰à¸²à¸ªà¸¹à¹ˆà¹€à¸¡à¸™à¸¹à¸œà¸¹à¹‰à¸”à¸¹à¹à¸¥</p>

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
            <p style={{ color: "#ff4444", fontSize: 13, marginBottom: 10 }}>à¸£à¸«à¸±à¸ªà¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡</p>
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
                {key === "del" ? "âŒ«" : key}
              </button>
            ))}
          </div>

          <button
            className="context-menu-item"
            style={{ marginTop: 16, justifyContent: "center", background: "#333" }}
            onClick={onClose}
          >
            à¸¢à¸à¹€à¸¥à¸´à¸
          </button>
        </div>
      </div>
    );
  }

  // à¸”à¹ˆà¸²à¸™à¸•à¸£à¸§à¸ˆà¸—à¸µà¹ˆ 2: PIN modal à¸ªà¸³à¸«à¸£à¸±à¸šà¸¢à¸·à¸™à¸¢à¸±à¸™à¸à¸²à¸£ "à¸›à¸´à¸”à¹à¸­à¸›" (à¸‚à¸­à¸‡à¹€à¸”à¸´à¸¡)
  if (showPinModal) {
    return (
      <div
        className="context-menu-overlay"
        onClick={(e) => { e.stopPropagation(); setShowPinModal(false); setPinInput(""); setPinError(false); }}
      >
        <div className="context-menu" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
          <h3 style={{ margin: "0 0 8px" }}>ðŸ”’ à¸¢à¸·à¸™à¸¢à¸±à¸™à¸£à¸«à¸±à¸ªà¸à¹ˆà¸­à¸™à¸›à¸´à¸”à¹à¸­à¸›</h3>
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

          {pinError && <p style={{ color: "#ff4444", fontSize: 13, marginBottom: 10 }}>à¸£à¸«à¸±à¸ªà¹„à¸¡à¹ˆà¸–à¸¹à¸à¸•à¹‰à¸­à¸‡</p>}

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
                {key === "del" ? "âŒ«" : key}
              </button>
            ))}
          </div>

          <button
            className="context-menu-item"
            style={{ marginTop: 16, justifyContent: "center", background: "#333" }}
            onClick={() => { setShowPinModal(false); setPinInput(""); setPinError(false); }}
          >
            à¸¢à¸à¹€à¸¥à¸´à¸
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
          <h3 style={{ margin: "0 0 8px" }}>ðŸ” à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ PIN</h3>

          <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
            {pinChangeStep === "enter"
              ? "à¸à¸£à¸­à¸ PIN à¹ƒà¸«à¸¡à¹ˆ (4 à¸«à¸¥à¸±à¸)"
              : "à¸¢à¸·à¸™à¸¢à¸±à¸™ PIN à¸­à¸µà¸à¸„à¸£à¸±à¹‰à¸‡"}
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
                {key === "del" ? "âŒ«" : key}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              className="context-menu-item"
              style={{ justifyContent: "center", background: "#333", flex: 1 }}
              onClick={closePinChangeModal}
            >
              à¸›à¸´à¸”
            </button>

            {pinChangeSuccess && (
              <button
                className="context-menu-item"
                style={{ justifyContent: "center", background: "#2f5f2f", flex: 1 }}
                onClick={closePinChangeModal}
              >
                à¹€à¸ªà¸£à¹‡à¸ˆà¸ªà¸´à¹‰à¸™
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // à¸«à¸™à¹‰à¸²à¸ˆà¸­à¹€à¸¡à¸™à¸¹à¸«à¸¥à¸±à¸ (à¹à¸ªà¸”à¸‡à¹€à¸¡à¸·à¹ˆà¸­à¸à¸£à¸­à¸à¸£à¸«à¸±à¸ª 7053 à¸œà¹ˆà¸²à¸™à¹à¸¥à¹‰à¸§)
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
          <h3 style={{ margin: 0 }}>âš™ï¸ Settings</h3>
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
          <span style={{ fontSize: 24 }}>ðŸ“·</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Camera Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {cameraStatus}
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>â€º</span>
        </button>

        {/* 2. Printer Config */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("printer")}
        >
          <span style={{ fontSize: 24 }}>ðŸ–¨ï¸</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Printer Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              {printerStatus}
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>â€º</span>
        </button>

        {/* 3. Paper Position Config */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("paper")}
        >
          <span style={{ fontSize: 24 }}>ðŸ“„</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>Paper Position Config</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              à¸›à¸£à¸±à¸š Scale, Vertical, Horizontal
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>â€º</span>
        </button>

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        {/* 4. Request Image (à¸žà¸´à¸¡à¸žà¹Œà¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡) */}
        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => {
            onClose();
            navigate("/request-image");
          }}
        >
          <span style={{ fontSize: 24 }}>ðŸ–¼ï¸</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>à¸žà¸´à¸¡à¸žà¹Œà¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              Request Image Print
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>â€º</span>
        </button>

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        <button
          className="context-menu-item context-menu-config-item"
          onClick={() => setActiveModal("pin")}
        >
          <span style={{ fontSize: 24 }}>ðŸ”</span>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontWeight: 600 }}>à¹€à¸›à¸¥à¸µà¹ˆà¸¢à¸™ PIN</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
              Menu PIN / Close App PIN
            </div>
          </div>
          <span style={{ opacity: 0.4, fontSize: 18 }}>â€º</span>
        </button>

        <div style={{ borderTop: "1px solid #333", margin: "12px 0" }} />

        {/* 5. Format Reset */}
        {!showResetConfirm ? (
          <button
            className="context-menu-item"
            style={{ justifyContent: "center", color: "#ffa502" }}
            onClick={() => setShowResetConfirm(true)}
          >
            ðŸ”„ Format Reset
          </button>
        ) : (
          <div className="context-menu-confirm-box">
            <p style={{ fontSize: 13, marginBottom: 8, textAlign: "center" }}>
              âš ï¸ à¸•à¹‰à¸­à¸‡à¸à¸²à¸£à¸¥à¹‰à¸²à¸‡à¸„à¹ˆà¸²à¸—à¸±à¹‰à¸‡à¸«à¸¡à¸”à¹à¸¥à¸°à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸² Machine à¹ƒà¸«à¸¡à¹ˆ?
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="context-menu-confirm-cancel"
                onClick={() => setShowResetConfirm(false)}
              >
                à¸¢à¸à¹€à¸¥à¸´à¸
              </button>
              <button
                className="context-menu-confirm-ok"
                onClick={handleFormatReset}
              >
                à¸¢à¸·à¸™à¸¢à¸±à¸™ Reset
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
          âŒ à¸›à¸´à¸”à¹à¸­à¸› / Close App
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
