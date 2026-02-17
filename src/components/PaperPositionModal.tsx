import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PaperConfig {
  scale: number;
  vertical: number;
  horizontal: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_CONFIG: PaperConfig = {
  scale: 100,
  vertical: 0,
  horizontal: 0,
};

export default function PaperPositionModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<"portrait" | "landscape">("portrait");
  const [portraitConfig, setPortraitConfig] = useState<PaperConfig>({ ...DEFAULT_CONFIG });
  const [landscapeConfig, setLandscapeConfig] = useState<PaperConfig>({ ...DEFAULT_CONFIG });
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const currentConfig = tab === "portrait" ? portraitConfig : landscapeConfig;
  const setCurrentConfig = tab === "portrait" ? setPortraitConfig : setLandscapeConfig;

  // Load saved config from localStorage
  useEffect(() => {
    if (!open) return;
    try {
      const savedPortrait = localStorage.getItem("paperConfigPortrait");
      if (savedPortrait) setPortraitConfig(JSON.parse(savedPortrait));
      else setPortraitConfig({ ...DEFAULT_CONFIG });

      const savedLandscape = localStorage.getItem("paperConfigLandscape");
      if (savedLandscape) setLandscapeConfig(JSON.parse(savedLandscape));
      else setLandscapeConfig({ ...DEFAULT_CONFIG });
    } catch {
      setPortraitConfig({ ...DEFAULT_CONFIG });
      setLandscapeConfig({ ...DEFAULT_CONFIG });
    }
    setSavedMessage("");
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to backend state
      await invoke("set_paper_config", {
        orientation: "portrait",
        scale: portraitConfig.scale,
        vertical: portraitConfig.vertical,
        horizontal: portraitConfig.horizontal,
      });
      await invoke("set_paper_config", {
        orientation: "landscape",
        scale: landscapeConfig.scale,
        vertical: landscapeConfig.vertical,
        horizontal: landscapeConfig.horizontal,
      });

      // Save to localStorage for persistence
      localStorage.setItem("paperConfigPortrait", JSON.stringify(portraitConfig));
      localStorage.setItem("paperConfigLandscape", JSON.stringify(landscapeConfig));

      setSavedMessage("✅ บันทึกสำเร็จ!");
      setTimeout(() => setSavedMessage(""), 2000);
    } catch {
      setSavedMessage("❌ บันทึกไม่สำเร็จ");
    }
    setSaving(false);
  };

  const handleTestPrint = useCallback(async () => {
    const selectedPrinter = localStorage.getItem("selectedPrinter");
    if (!selectedPrinter) {
      setSavedMessage("⚠️ กรุณาเลือกเครื่องปริ้นก่อน");
      setTimeout(() => setSavedMessage(""), 3000);
      return;
    }

    setPrinting(true);
    setSavedMessage("🖨️ กำลัง Test Print...");
    try {
      await invoke("print_test_photo", {
        printerName: selectedPrinter,
        scale: currentConfig.scale,
        verticalOffset: currentConfig.vertical,
        horizontalOffset: currentConfig.horizontal,
        isLandscape: tab === "landscape",
      });
      setSavedMessage("✅ Test Print สำเร็จ!");
    } catch (err: any) {
      setSavedMessage(`❌ Print Error: ${err?.toString()?.slice(0, 60)}`);
    }
    setPrinting(false);
    setTimeout(() => setSavedMessage(""), 4000);
  }, [currentConfig, tab]);

  const handleReset = () => {
    setCurrentConfig({ ...DEFAULT_CONFIG });
  };

  const updateValue = (key: keyof PaperConfig, value: number) => {
    setCurrentConfig((prev) => ({ ...prev, [key]: value }));
  };

  if (!open) return null;

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal config-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-header">
          <h3>📄 Paper Position Config</h3>
          <button className="config-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tab selector */}
        <div className="config-tabs">
          <button
            className={`config-tab ${tab === "portrait" ? "active" : ""}`}
            onClick={() => setTab("portrait")}
          >
            📐 Portrait (4x6)
          </button>
          <button
            className={`config-tab ${tab === "landscape" ? "active" : ""}`}
            onClick={() => setTab("landscape")}
          >
            🖼️ Landscape (6x4)
          </button>
        </div>

        <div className="config-body">
          {/* Scale */}
          <div className="config-slider-group">
            <div className="config-slider-header">
              <label className="config-label">Scale (ขนาด)</label>
              <span className="config-slider-value">{currentConfig.scale}%</span>
            </div>
            <p className="config-slider-desc">ขยายรูปให้เต็มกระดาษ (50% - 150%)</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="config-pm-btn"
                onClick={() => updateValue("scale", Math.max(50, currentConfig.scale - 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                −
              </button>
              <input
                type="range"
                min={50}
                max={150}
                step={1}
                value={currentConfig.scale}
                onChange={(e) => updateValue("scale", Number(e.target.value))}
                className="config-slider"
                style={{ flex: 1 }}
              />
              <button
                className="config-pm-btn"
                onClick={() => updateValue("scale", Math.min(150, currentConfig.scale + 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                +
              </button>
            </div>
            <div className="config-slider-labels">
              <span>50%</span>
              <span>100%</span>
              <span>150%</span>
            </div>
          </div>

          {/* Vertical */}
          <div className="config-slider-group">
            <div className="config-slider-header">
              <label className="config-label">Vertical (แนวตั้ง)</label>
              <span className="config-slider-value">{currentConfig.vertical}</span>
            </div>
            <p className="config-slider-desc">
              ค่าลบ = ขยับขึ้นบน • ค่าบวก = ขยับลงล่าง (-100 ถึง 100)
            </p>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0" }}>
              <span style={{ fontSize: 11, opacity: 0.5 }}>-100 (↑)</span>
              <button
                className="config-pm-btn"
                onClick={() => updateValue("vertical", Math.max(-100, currentConfig.vertical - 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                −
              </button>
              <div style={{ height: 160, width: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={currentConfig.vertical}
                  onChange={(e) => updateValue("vertical", Number(e.target.value))}
                  className="config-slider"
                  style={{
                    width: 160,
                    transform: "rotate(-270deg)",
                    transformOrigin: "center center",
                  }}
                />
              </div>
              <button
                className="config-pm-btn"
                onClick={() => updateValue("vertical", Math.min(100, currentConfig.vertical + 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                +
              </button>
              <span style={{ fontSize: 11, opacity: 0.5 }}>+100 (↓)</span>
            </div>
          </div>

          {/* Horizontal */}
          <div className="config-slider-group">
            <div className="config-slider-header">
              <label className="config-label">Horizontal (แนวนอน)</label>
              <span className="config-slider-value">{currentConfig.horizontal}</span>
            </div>
            <p className="config-slider-desc">
              ค่าลบ = ขยับไปซ้าย • ค่าบวก = ขยับไปขวา (-100 ถึง 100)
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                className="config-pm-btn"
                onClick={() => updateValue("horizontal", Math.max(-100, currentConfig.horizontal - 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                −
              </button>
              <input
                type="range"
                min={-100}
                max={100}
                step={1}
                value={currentConfig.horizontal}
                onChange={(e) => updateValue("horizontal", Number(e.target.value))}
                className="config-slider"
                style={{ flex: 1 }}
              />
              <button
                className="config-pm-btn"
                onClick={() => updateValue("horizontal", Math.min(100, currentConfig.horizontal + 1))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                +
              </button>
            </div>
            <div className="config-slider-labels">
              <span>-100 (←)</span>
              <span>0</span>
              <span>+100 (→)</span>
            </div>
          </div>

          {/* Paper Preview */}
          <div className="config-paper-preview">
            <div
              className="config-paper"
              style={{
                width: tab === "portrait" ? 120 : 180,
                height: tab === "portrait" ? 180 : 120,
              }}
            >
              <div
                className="config-paper-image"
                style={{
                  width: `${currentConfig.scale}%`,
                  height: `${currentConfig.scale}%`,
                  transform: `translate(${currentConfig.horizontal * 0.3}px, ${currentConfig.vertical * 0.3}px)`,
                }}
              >
                📷
              </div>
            </div>
            <p style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
              ตัวอย่างตำแหน่งรูปบนกระดาษ
            </p>
          </div>

          {/* Action row */}
          <div className="config-actions-row">
            <button className="config-reset-btn" onClick={handleReset}>
              🔄 Reset ค่าเริ่มต้น
            </button>
            <button
              className="config-test-print-btn"
              onClick={handleTestPrint}
              disabled={printing}
            >
              {printing ? "⏳ Printing..." : "🖨️ Test Print"}
            </button>
          </div>
        </div>

        {savedMessage && (
          <div className="config-saved-message">{savedMessage}</div>
        )}

        <div className="config-footer">
          <button className="config-cancel-btn" onClick={onClose}>
            ยกเลิก / Cancel
          </button>
          <button
            className="config-save-btn"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "กำลังบันทึก..." : "💾 บันทึก / Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
