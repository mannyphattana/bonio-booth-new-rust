import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PrinterInfo {
  name: string;
  status: string;
  is_online: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

interface PresetStatus {
  cut: boolean;
  nocut: boolean;
}

export default function PrinterConfigModal({ open, onClose }: Props) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const [presetStatus, setPresetStatus] = useState<PresetStatus>({ cut: false, nocut: false });
  const [configuring, setConfiguring] = useState<"cut" | "nocut" | null>(null);

  // Load current config
  useEffect(() => {
    if (!open) return;
    setSelectedPrinter(localStorage.getItem("selectedPrinter") || "");
    setSavedMessage("");
    loadPrinters();
  }, [open]);

  const loadPrinters = useCallback(async () => {
    setLoading(true);
    try {
      const list: PrinterInfo[] = await invoke("get_printers");
      setPrinters(list);
    } catch {
      setPrinters([]);
    }
    setLoading(false);
  }, []);

  // Reload cut/no-cut preset status whenever the chosen printer changes
  const loadPresetStatus = useCallback(async (printerName: string) => {
    if (!printerName) {
      setPresetStatus({ cut: false, nocut: false });
      return;
    }
    try {
      const status: PresetStatus = await invoke("get_printer_preset_status", { printerName });
      setPresetStatus(status);
    } catch {
      setPresetStatus({ cut: false, nocut: false });
    }
  }, []);

  useEffect(() => {
    if (open) loadPresetStatus(selectedPrinter);
  }, [open, selectedPrinter, loadPresetStatus]);

  // Open the driver's Printing Preferences dialog for the operator to set the cut option,
  // then store the resulting DEVMODE as the cut/no-cut preset (single-driver model).
  const handleConfigureMode = async (cut: boolean) => {
    if (!selectedPrinter) return;
    setConfiguring(cut ? "cut" : "nocut");
    try {
      const saved: boolean = await invoke("capture_printer_devmode", {
        printerName: selectedPrinter,
        cut,
      });
      if (saved) await loadPresetStatus(selectedPrinter);
    } catch {
      // dialog failed / not on Windows — leave status unchanged
    }
    setConfiguring(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("set_selected_printer", { printerName: selectedPrinter });
      localStorage.setItem("selectedPrinter", selectedPrinter);
      setSavedMessage("✅ บันทึกสำเร็จ!");
      setTimeout(() => setSavedMessage(""), 2000);
    } catch {
      setSavedMessage("❌ บันทึกไม่สำเร็จ");
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-header">
          <h3>🖨️ Printer Config</h3>
          <button className="config-close-btn" onClick={onClose}>✕</button>
        </div>

        <div className="config-body">
          <p className="config-label">เลือกเครื่องปริ้น / Select Printer</p>

          <div className="config-info-box">
            <p>📋 <strong>การตัดกระดาษ (driver เดียว):</strong></p>
            <p style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
              ระบบเลือกตัด/ไม่ตัดเองตาม frame — ใช้ driver เดียว ไม่ต้องลง driver (CUT) แยก
            </p>
            <p style={{ fontSize: 12, opacity: 0.8 }}>
              • Frame 2x6 / 6x2 → <span style={{ color: "#ff6b6b" }}>✂️ ตัดกระดาษ</span>
            </p>
            <p style={{ fontSize: 12, opacity: 0.8 }}>
              • Frame 4x6 / 6x4 → <span style={{ color: "#51cf66" }}>ไม่ตัดกระดาษ</span>
            </p>
          </div>

          {loading ? (
            <div className="config-empty">กำลังค้นหาเครื่องปริ้น...</div>
          ) : printers.length === 0 ? (
            <div className="config-empty">
              ⚠️ ไม่พบเครื่องปริ้น / No printer found
              <br />
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                กรุณาเชื่อมต่อเครื่องปริ้นผ่าน USB
              </span>
            </div>
          ) : (
            <div className="config-device-list">
              {printers.map((printer) => (
                <button
                  key={printer.name}
                  className={`config-device-item ${selectedPrinter === printer.name ? "selected" : ""}`}
                  onClick={() => setSelectedPrinter(printer.name)}
                >
                  <span className="config-device-icon">🖨️</span>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <span className="config-device-name">{printer.name}</span>
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                      สถานะ: {printer.status} •{" "}
                      {printer.is_online ? (
                        <span style={{ color: "#51cf66" }}>ออนไลน์</span>
                      ) : (
                        <span style={{ color: "#ff6b6b" }}>ออฟไลน์</span>
                      )}
                    </div>
                  </div>
                  {selectedPrinter === printer.name && (
                    <span className="config-device-check">✓</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <button className="config-refresh-btn" onClick={loadPrinters}>
            🔄 Refresh
          </button>

          {selectedPrinter && (
            <div className="config-info-box" style={{ marginTop: 12 }}>
              <p>⚙️ <strong>ตั้งค่าโหมดตัด (ทำครั้งเดียวต่อเครื่อง):</strong></p>
              <p style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
                กดเพื่อเปิดหน้าตั้งค่าของ driver แล้วเลือกค่า "2 inch cut" ให้ตรงกับแต่ละโหมด
                ระบบจะจำค่าไว้ใช้พิมพ์อัตโนมัติ
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="config-refresh-btn"
                  style={{ flex: 1, margin: 0 }}
                  onClick={() => handleConfigureMode(true)}
                  disabled={configuring !== null}
                >
                  {configuring === "cut" ? "กำลังตั้งค่า..." : "✂️ โหมดตัด (2x6)"}{" "}
                  {presetStatus.cut ? "✓" : ""}
                </button>
                <button
                  className="config-refresh-btn"
                  style={{ flex: 1, margin: 0 }}
                  onClick={() => handleConfigureMode(false)}
                  disabled={configuring !== null}
                >
                  {configuring === "nocut" ? "กำลังตั้งค่า..." : "▭ โหมดไม่ตัด (4x6)"}{" "}
                  {presetStatus.nocut ? "✓" : ""}
                </button>
              </div>
              <p style={{ fontSize: 11, marginTop: 8, opacity: 0.7 }}>
                สถานะ: ตัด {presetStatus.cut ? "✅ ตั้งแล้ว" : "⚠️ ยังไม่ตั้ง"} • ไม่ตัด{" "}
                {presetStatus.nocut ? "✅ ตั้งแล้ว" : "⚠️ ยังไม่ตั้ง"}
              </p>
            </div>
          )}
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
            disabled={saving || !selectedPrinter}
          >
            {saving ? "กำลังบันทึก..." : "💾 บันทึก / Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
