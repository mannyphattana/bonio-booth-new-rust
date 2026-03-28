import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  getSelectedPrinter as getProfileSelectedPrinter,
  setSelectedPrinter as setProfileSelectedPrinter,
} from "../config/printProfile";

interface PrinterInfo {
  name: string;
  status: string;
  is_online: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PrinterConfigModal({ open, onClose }: Props) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  // Load current config
  useEffect(() => {
    if (!open) return;
    setSelectedPrinter(getProfileSelectedPrinter());
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("set_selected_printer", { printerName: selectedPrinter });
      setProfileSelectedPrinter(selectedPrinter);
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
            <p>📋 <strong>กฎการตัดกระดาษ:</strong></p>
            <p style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>
              • Frame 2x6 (Portrait) → <span style={{ color: "#ff6b6b" }}>✂️ ตัดกระดาษ</span>
            </p>
            <p style={{ fontSize: 12, opacity: 0.8 }}>
              • Frame 6x2 (Landscape) → <span style={{ color: "#ff6b6b" }}>✂️ ตัดกระดาษ</span>
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
