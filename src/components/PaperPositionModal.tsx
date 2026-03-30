import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { setPrinting as setPrintingState } from "../utils/printingState";
import {
  ACTIVE_PAPER_TYPE,
  ENABLE_OFFICE_PAPER_MENU,
  getPaperConfig,
  getPaperSize,
  getSelectedPrinter,
  setPaperConfig,
  setPaperSize,
  type PaperConfig,
} from "../config/printProfile";

// ✅ นำเข้ารูปภาพทั้ง 4 แบบ จากโฟลเดอร์ assets
import img4x6Port from "../assets/print_4x6_port.png";
import img2x6Port from "../assets/print_2x6_port.png";
import img6x4Land from "../assets/print_6x4_land.png";
import img6x2Land from "../assets/print_6x2_land.png";
import imgA4Port from "../assets/images/print_a4_port.png";
import imgA4Land from "../assets/images/print_a4_land.png";
import imgA3Port from "../assets/images/print_a3_port.png";
import imgA3Land from "../assets/images/print_a3_land.png";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DEFAULT_CONFIG: PaperConfig = {
  scale: 100,
  vertical: 0,
  horizontal: 0,
};

const normalizePaperSelection = (
  orientation: "portrait" | "landscape",
  value: "2x6" | "4x6" | "6x2" | "6x4" | "a4" | "a3" | null,
): "2x6" | "4x6" | "6x2" | "6x4" | "a4" | "a3" => {
  if (!value) return orientation === "portrait" ? "4x6" : "6x4";
  if (!ENABLE_OFFICE_PAPER_MENU && (value === "a4" || value === "a3")) {
    return orientation === "portrait" ? "4x6" : "6x4";
  }
  return value;
};

export default function PaperPositionModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<"portrait" | "landscape">("portrait");
  const [portraitConfig, setPortraitConfig] = useState<PaperConfig>({ ...DEFAULT_CONFIG });
  const [landscapeConfig, setLandscapeConfig] = useState<PaperConfig>({ ...DEFAULT_CONFIG });
  const [portraitPaperSize, setPortraitPaperSize] = useState<"2x6" | "4x6" | "a4" | "a3">("a4");
  const [landscapePaperSize, setLandscapePaperSize] = useState<"6x2" | "6x4" | "a4" | "a3">("a4");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  const currentConfig = tab === "portrait" ? portraitConfig : landscapeConfig;
  const setCurrentConfig = tab === "portrait" ? setPortraitConfig : setLandscapeConfig;

  useEffect(() => {
    if (!open) return;
    try {
      const savedPortrait = getPaperConfig("portrait");
      if (savedPortrait) setPortraitConfig(savedPortrait);
      else setPortraitConfig({ ...DEFAULT_CONFIG });

      const savedLandscape = getPaperConfig("landscape");
      if (savedLandscape) setLandscapeConfig(savedLandscape);
      else setLandscapeConfig({ ...DEFAULT_CONFIG });

      setPortraitPaperSize(
        normalizePaperSelection(
          "portrait",
          getPaperSize("portrait") as "2x6" | "4x6" | "a4" | "a3" | null,
        ) as "2x6" | "4x6" | "a4" | "a3",
      );
      setLandscapePaperSize(
        normalizePaperSelection(
          "landscape",
          getPaperSize("landscape") as "6x2" | "6x4" | "a4" | "a3" | null,
        ) as "6x2" | "6x4" | "a4" | "a3",
      );
    } catch {
      setPortraitConfig({ ...DEFAULT_CONFIG });
      setLandscapeConfig({ ...DEFAULT_CONFIG });
    }
    setSavedMessage("");
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    try {
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

      setPaperConfig("portrait", portraitConfig);
      setPaperConfig("landscape", landscapeConfig);
      setPaperSize("portrait", portraitPaperSize);
      setPaperSize("landscape", landscapePaperSize);

      setSavedMessage("✅ บันทึกสำเร็จ!");
      setTimeout(() => setSavedMessage(""), 2000);
    } catch {
      setSavedMessage("❌ บันทึกไม่สำเร็จ");
    }
    setSaving(false);
  };

  const handleTestPrint = useCallback(async () => {
    const selectedPrinter = getSelectedPrinter();
    if (!selectedPrinter) {
      setSavedMessage("⚠️ กรุณาเลือกเครื่องปริ้นก่อน");
      setTimeout(() => setSavedMessage(""), 3000);
      return;
    }

    const selectedPaper = tab === "portrait" ? portraitPaperSize : landscapePaperSize;
    const frameType = selectedPaper === "a4" || selectedPaper === "a3"
      ? (tab === "portrait" ? "4x6" : "6x4")
      : selectedPaper;
    const displayPaper = selectedPaper === "a4"
      ? (tab === "portrait" ? "A4 Portrait" : "A4 Landscape")
      : selectedPaper === "a3"
        ? (tab === "portrait" ? "A3 Portrait" : "A3 Landscape")
      : selectedPaper;

    const selectedPaperType = selectedPaper === "a3"
      ? "a3"
      : selectedPaper === "a4"
        ? "a4"
        : ACTIVE_PAPER_TYPE;

    const cutMode = selectedPaper === "2x6" || selectedPaper === "6x2"
      ? "cut"
      : "no-cut";

    setPrinting(true);
    setSavedMessage(`🖨️ กำลัง Test Print (${displayPaper})...`);
    
    setPrintingState(true, 45000); 
    console.log("[PaperPositionModal] Printing state set to true before test print");
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    try {
      await invoke("print_test_photo", {
        printerName: selectedPrinter,
        scale: currentConfig.scale,
        verticalOffset: currentConfig.vertical,
        horizontalOffset: currentConfig.horizontal,
        frameType,
        paperType: selectedPaperType,
        cutMode,
      });
      try {
        await invoke("reduce_paper_level", { copies: 1 });
      } catch (e) {
        console.warn("[PaperPositionModal] reduce_paper_level failed (non-blocking):", e);
      }
      setSavedMessage("✅ Test Print สำเร็จ!");
    } catch (err: any) {
      setSavedMessage(`❌ Print Error: ${err?.toString()?.slice(0, 60)}`);
    } finally {
      setPrinting(false); 
      console.log("[PaperPositionModal] Test print completed, clearing printing state");
      setPrintingState(false);
      setTimeout(() => setSavedMessage(""), 4000);
    }
  }, [currentConfig, tab, portraitPaperSize, landscapePaperSize]);

  const handleReset = () => {
    setCurrentConfig({ ...DEFAULT_CONFIG });
  };

  const updateValue = (key: keyof PaperConfig, value: number) => {
    setCurrentConfig((prev) => ({ ...prev, [key]: value }));
  };

  const renderSheetPreview = (
    size: "a4" | "a3",
    landscape = false,
  ) => (
    <img
      src={
        size === "a3"
          ? (landscape ? imgA3Land : imgA3Port)
          : (landscape ? imgA4Land : imgA4Port)
      }
      alt={`${size.toUpperCase()} ${landscape ? "Landscape" : "Portrait"}`}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "fill",
      }}
    />
  );

  if (!open) return null;

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal config-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-header">
          <h3>📄 Paper Position Config</h3>
          <button className="config-close-btn" onClick={onClose}>✕</button>
        </div>

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

        <div style={{ display: "flex", gap: 8, padding: "10px 20px 0" }}>
          {tab === "portrait" ? (
            <>
              {ENABLE_OFFICE_PAPER_MENU && (
                <>
                  <button
                    onClick={() => setPortraitPaperSize("a4")}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                      borderColor: portraitPaperSize === "a4" ? "#4dabf7" : "#555",
                      background: portraitPaperSize === "a4" ? "rgba(77,171,247,0.15)" : "transparent",
                      color: portraitPaperSize === "a4" ? "#4dabf7" : "#aaa",
                      fontWeight: 600, cursor: "pointer", fontSize: 13,
                    }}
                  >
                    A4 (แนวตั้ง)
                  </button>
                  <button
                    onClick={() => setPortraitPaperSize("a3")}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                      borderColor: portraitPaperSize === "a3" ? "#9775fa" : "#555",
                      background: portraitPaperSize === "a3" ? "rgba(151,117,250,0.15)" : "transparent",
                      color: portraitPaperSize === "a3" ? "#9775fa" : "#aaa",
                      fontWeight: 600, cursor: "pointer", fontSize: 13,
                    }}
                  >
                    A3 (แนวตั้ง)
                  </button>
                </>
              )}
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
              {ENABLE_OFFICE_PAPER_MENU && (
                <>
                  <button
                    onClick={() => setLandscapePaperSize("a4")}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                      borderColor: landscapePaperSize === "a4" ? "#4dabf7" : "#555",
                      background: landscapePaperSize === "a4" ? "rgba(77,171,247,0.15)" : "transparent",
                      color: landscapePaperSize === "a4" ? "#4dabf7" : "#aaa",
                      fontWeight: 600, cursor: "pointer", fontSize: 13,
                    }}
                  >
                    A4 (แนวนอน)
                  </button>
                  <button
                    onClick={() => setLandscapePaperSize("a3")}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, border: "2px solid",
                      borderColor: landscapePaperSize === "a3" ? "#9775fa" : "#555",
                      background: landscapePaperSize === "a3" ? "rgba(151,117,250,0.15)" : "transparent",
                      color: landscapePaperSize === "a3" ? "#9775fa" : "#aaa",
                      fontWeight: 600, cursor: "pointer", fontSize: 13,
                    }}
                  >
                    A3 (แนวนอน)
                  </button>
                </>
              )}
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
          {/* ================= Sliders ================= */}
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

          {/* ================= Paper Preview Area ================= */}
          <div className="config-paper-preview" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '10px' }}>
            
            {/* กล่องกระดาษจำลอง (เส้นประขาว) ฟิกซ์สัดส่วน 4:6 หรือ 6:4 */}
            <div
              style={{
                width: tab === "portrait" ? "160px" : "240px", 
                height: tab === "portrait" ? "240px" : "160px",
                border: "2px dashed rgba(255,255,255,0.7)", 
                position: "relative",
                // ✅ เปิด visible ให้รูปทะลุออกมากรอบได้ตอนเลื่อน offset หรือขยายเกิน 100%
                overflow: "visible", 
                transition: "width 0.3s ease, height 0.3s ease"
              }}
            >
              {/* ชุดรูปภาพ (จะขยับตาม slider ทะลุเส้นประได้) */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  // ถ้าเป็นแนวนอน 6x2 จะซ้อนบน-ล่าง / ถ้าแนวตั้ง 2x6 จะซ้อนซ้าย-ขวา
                  flexDirection: tab === "portrait" ? "row" : "column", 
                  // ✅ คำนวณ Scale % และ Offset (X,Y)
                  transform: `translate(${currentConfig.horizontal}px, ${currentConfig.vertical}px) scale(${currentConfig.scale / 100})`,
                  transformOrigin: "center center",
                  transition: "transform 0.1s ease-out"
                }}
              >
                {/* เงื่อนไขแสดงรูป: เช็คแท็บและขนาดที่เลือก */}
                {tab === "portrait" ? (
                  portraitPaperSize === "2x6" ? (
                    // แนวตั้ง 2x6 (2 รูปประกบซ้าย-ขวา)
                    <>
                      <img src={img2x6Port} alt="2x6 left" style={{ width: "50%", height: "100%", objectFit: "fill", borderRight: "1px dashed rgba(255,255,255,0.2)" }} />
                      <img src={img2x6Port} alt="2x6 right" style={{ width: "50%", height: "100%", objectFit: "fill" }} />
                    </>
                  ) : portraitPaperSize === "a4" ? (
                    renderSheetPreview("a4", false)
                  ) : portraitPaperSize === "a3" ? (
                    renderSheetPreview("a3", false)
                  ) : (
                    // แนวตั้ง 4x6 (1 รูปเต็มกรอบ)
                    <img src={img4x6Port} alt="4x6" style={{ width: "100%", height: "100%", objectFit: "fill" }} />
                  )
                ) : (
                  landscapePaperSize === "6x2" ? (
                    // แนวนอน 6x2 (2 รูปประกบบน-ล่าง)
                    <>
                      <img src={img6x2Land} alt="6x2 top" style={{ width: "100%", height: "50%", objectFit: "fill", borderBottom: "1px dashed rgba(255,255,255,0.2)" }} />
                      <img src={img6x2Land} alt="6x2 bottom" style={{ width: "100%", height: "50%", objectFit: "fill" }} />
                    </>
                  ) : landscapePaperSize === "a4" ? (
                    renderSheetPreview("a4", true)
                  ) : landscapePaperSize === "a3" ? (
                    renderSheetPreview("a3", true)
                  ) : (
                    // แนวนอน 6x4 (1 รูปเต็มกรอบ)
                    <img src={img6x4Land} alt="6x4" style={{ width: "100%", height: "100%", objectFit: "fill" }} />
                  )
                )}
              </div>
            </div>

            <p style={{ fontSize: 11, opacity: 0.5, marginTop: 45 }}>
              ตัวอย่างตำแหน่งรูปบนกระดาษ ({
                (tab === "portrait" ? portraitPaperSize : landscapePaperSize) === "a4"
                  ? (tab === "portrait" ? "A4 Portrait" : "A4 Landscape")
                  : (tab === "portrait" ? portraitPaperSize : landscapePaperSize)
              })
            </p>
          </div>

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