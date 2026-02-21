import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { setPrinting as setPrintingState } from "../utils/printingState";

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
  // Paper size selection per orientation
  const [portraitPaperSize, setPortraitPaperSize] = useState<"2x6" | "4x6">("4x6");
  const [landscapePaperSize, setLandscapePaperSize] = useState<"6x2" | "6x4">("6x4");
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

      setPortraitPaperSize((localStorage.getItem("paperSizePortrait") as "2x6" | "4x6") || "4x6");
      setLandscapePaperSize((localStorage.getItem("paperSizeLandscape") as "6x2" | "6x4") || "6x4");
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
      localStorage.setItem("paperSizePortrait", portraitPaperSize);
      localStorage.setItem("paperSizeLandscape", landscapePaperSize);

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

    const frameType = tab === "portrait" ? portraitPaperSize : landscapePaperSize;

    setPrinting(true);
    setSavedMessage(`🖨️ กำลัง Test Print (${frameType})...`);
    
    // Set printing state BEFORE printing to prevent device check notifications
    setPrintingState(true, 45000); // 45 second timeout
    console.log("[PaperPositionModal] Printing state set to true before test print");
    
    // Small delay to ensure printing state is set before device check runs
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      await invoke("print_test_photo", {
        printerName: selectedPrinter,
        scale: currentConfig.scale,
        verticalOffset: currentConfig.vertical,
        horizontalOffset: currentConfig.horizontal,
        frameType,
      });
      // ลด paper level ที่หลังบ้าน 1 แผ่น (เส้นเดียวกับ bonio-booth: POST paper-level/reduce)
      try {
        await invoke("reduce_paper_level", { copies: 1 });
      } catch (e) {
        console.warn("[PaperPositionModal] reduce_paper_level failed (non-blocking):", e);
      }
      setSavedMessage("✅ Test Print สำเร็จ!");
    } catch (err: any) {
      setSavedMessage(`❌ Print Error: ${err?.toString()?.slice(0, 60)}`);
    } finally {
      setPrinting(false); // Clear local printing state
      // Clear printing state after print completes (includes grace period)
      console.log("[PaperPositionModal] Test print completed, clearing printing state");
      setPrintingState(false);
      setTimeout(() => setSavedMessage(""), 4000);
    }
  }, [currentConfig, tab, portraitPaperSize, landscapePaperSize]);

  const handleReset = () => {
    setCurrentConfig({ ...DEFAULT_CONFIG });
  };

  const handleShowPaperSizes = async () => {
    const selectedPrinter = localStorage.getItem("selectedPrinter");
    if (!selectedPrinter) {
      setSavedMessage("⚠️ กรุณาเลือกเครื่องปริ้นก่อน");
      setTimeout(() => setSavedMessage(""), 3000);
      return;
    }
    setSavedMessage("🔍 กำลังดึงข้อมูล Paper Sizes...");
    try {
      const sizes = await invoke<string[]>("get_printer_paper_sizes", { printerName: selectedPrinter });
      const list = sizes.length > 0 ? sizes.join("\n") : "(ไม่พบ paper sizes)";
      alert(`Paper Sizes ของ '${selectedPrinter}':\n\n${list}`);
      setSavedMessage("");
    } catch (err: any) {
      setSavedMessage(`❌ ${err?.toString()?.slice(0, 80)}`);
      setTimeout(() => setSavedMessage(""), 5000);
    }
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
            📐 Portrait
          </button>
          <button
            className={`config-tab ${tab === "landscape" ? "active" : ""}`}
            onClick={() => setTab("landscape")}
          >
            🖼️ Landscape
          </button>
        </div>

        {/* Paper size selector */}
        <div style={{ display: "flex", gap: 8, padding: "10px 20px 0" }}>
          {tab === "portrait" ? (
            <>
              <button
                onClick={() => setPortraitPaperSize("4x6")}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                  borderColor: portraitPaperSize === "4x6" ? "#51cf66" : "#555",
                  background: portraitPaperSize === "4x6" ? "rgba(81,207,102,0.15)" : "transparent",
                  color: portraitPaperSize === "4x6" ? "#51cf66" : "#aaa",
                  fontWeight: 600, cursor: "pointer", fontSize: 13,
                }}
              >
                4x6 (ไม่ตัด)
              </button>
              <button
                onClick={() => setPortraitPaperSize("2x6")}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                  borderColor: portraitPaperSize === "2x6" ? "#ff6b6b" : "#555",
                  background: portraitPaperSize === "2x6" ? "rgba(255,107,107,0.15)" : "transparent",
                  color: portraitPaperSize === "2x6" ? "#ff6b6b" : "#aaa",
                  fontWeight: 600, cursor: "pointer", fontSize: 13,
                }}
              >
                ✂️ 2x6 (ตัดกระดาษ)
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setLandscapePaperSize("6x4")}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                  borderColor: landscapePaperSize === "6x4" ? "#51cf66" : "#555",
                  background: landscapePaperSize === "6x4" ? "rgba(81,207,102,0.15)" : "transparent",
                  color: landscapePaperSize === "6x4" ? "#51cf66" : "#aaa",
                  fontWeight: 600, cursor: "pointer", fontSize: 13,
                }}
              >
                6x4 (ไม่ตัด)
              </button>
              <button
                onClick={() => setLandscapePaperSize("6x2")}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                  borderColor: landscapePaperSize === "6x2" ? "#ff6b6b" : "#555",
                  background: landscapePaperSize === "6x2" ? "rgba(255,107,107,0.15)" : "transparent",
                  color: landscapePaperSize === "6x2" ? "#ff6b6b" : "#aaa",
                  fontWeight: 600, cursor: "pointer", fontSize: 13,
                }}
              >
                ✂️ 6x2 (ตัดกระดาษ)
              </button>
            </>
          )}
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
                onClick={() => updateValue("scale", Math.max(50, Math.round((currentConfig.scale - 0.5) * 10) / 10))}
                style={{ width: 36, height: 36, borderRadius: "50%", border: "2px solid #666", background: "transparent", color: "#fff", fontSize: 20, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              >
                −
              </button>
              <input
                type="range"
                min={50}
                max={150}
                step={0.5}
                value={currentConfig.scale}
                onChange={(e) => updateValue("scale", Number(e.target.value))}
                className="config-slider"
                style={{ flex: 1 }}
              />
              <button
                className="config-pm-btn"
                onClick={() => updateValue("scale", Math.min(150, Math.round((currentConfig.scale + 0.5) * 10) / 10))}
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
                width: tab === "portrait"
                  ? (portraitPaperSize === "2x6" ? 60 : 120)
                  : (landscapePaperSize === "6x2" ? 180 : 180),
                height: tab === "portrait"
                  ? 180
                  : (landscapePaperSize === "6x2" ? 60 : 120),
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
              ตัวอย่างตำแหน่งรูปบนกระดาษ ({tab === "portrait" ? portraitPaperSize : landscapePaperSize})
            </p>
          </div>

          {/* Action row */}
          <div className="config-actions-row">
            <button className="config-reset-btn" onClick={handleReset}>
              🔄 Reset ค่าเริ่มต้น
            </button>
            <button
              className="config-debug-btn"
              onClick={handleShowPaperSizes}
              style={{ fontSize: "0.8em", opacity: 0.7 }}
            >
              🔍 Paper Sizes
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
