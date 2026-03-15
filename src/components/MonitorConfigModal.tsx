import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { disableDualMonitor } from "../utils/displayBroadcast";

interface MonitorInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isPrimary: boolean;
  scaleFactor: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MonitorConfigModal({ open, onClose }: Props) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [displayIdx, setDisplayIdx] = useState<number>(-1);
  const [isEnabled, setIsEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // ─── Load monitors & saved config when modal opens ───────────────────────
  useEffect(() => {
    if (!open) return;
    setMessage(null);

    invoke<MonitorInfo[]>("get_monitors")
      .then((list) => {
        setMonitors(list);

        // Restore previously selected display monitor
        try {
          const saved = JSON.parse(
            localStorage.getItem("displayMonitorConfig") || "null"
          );
          if (saved?.enabled) {
            setIsEnabled(true);
            const idx = list.findIndex(
              (m) => m.name === saved.displayName && m.x === saved.x && m.y === saved.y
            );
            if (idx >= 0) setDisplayIdx(idx);
          } else {
            setIsEnabled(false);
            setDisplayIdx(-1);
          }
        } catch {
          setIsEnabled(false);
          setDisplayIdx(-1);
        }
      })
      .catch((err) =>
        setMessage({ text: `❌ โหลด monitor ไม่ได้: ${err}`, ok: false })
      );
  }, [open]);

  // ─── Save & open display window ──────────────────────────────────────────
  const handleSave = async () => {
    if (displayIdx < 0 || displayIdx >= monitors.length) {
      setMessage({ text: "กรุณาเลือกจอแสดงผลก่อน", ok: false });
      return;
    }

    const chosen = monitors[displayIdx];

    // Interactive monitor = the other monitor (any monitor that is NOT the chosen display)
    const interactive = monitors.find((_, idx) => idx !== displayIdx);
    if (!interactive) {
      setMessage({ text: "⚠️ ต้องมีอย่างน้อย 2 จอเพื่อใช้ Dual Monitor", ok: false });
      return;
    }

    setLoading(true);
    setMessage(null);
    try {
      const config = {
        enabled: true,
        displayName: chosen.name,
        x: chosen.x,
        y: chosen.y,
        width: chosen.width,
        height: chosen.height,
        // Store interactive position so we can restore it when disabling
        interactiveX: interactive.x,
        interactiveY: interactive.y,
        interactiveWidth: interactive.width,
        interactiveHeight: interactive.height,
      };
      localStorage.setItem("displayMonitorConfig", JSON.stringify(config));

      // Step 1: Move the main (interactive) window to the other monitor first,
      // so it doesn't sit behind the camera window.
      await invoke("move_main_window", { x: interactive.x, y: interactive.y });

      // Step 2: Open or reposition the camera window on the chosen display monitor.
      await invoke("open_display_window", {
        x: chosen.x,
        y: chosen.y,
        width: chosen.width,
        height: chosen.height,
      });

      setIsEnabled(true);
      setMessage({ text: "✅ เปิดจอแสดงผลสำเร็จ", ok: true });
    } catch (err: any) {
      setMessage({ text: `❌ เกิดข้อผิดพลาด: ${err}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  // ─── Close display window ─────────────────────────────────────────────────
  const handleCloseDisplay = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await invoke("close_display_window");

      // Move main window back to primary (or stored interactive position fallback)
      const primary = monitors.find((m) => m.isPrimary) ?? monitors[0];
      if (primary) {
        await invoke("move_main_window", { x: primary.x, y: primary.y });
      }

      disableDualMonitor();
      setIsEnabled(false);
      setDisplayIdx(-1);
      setMessage({ text: "✅ ปิดจอแสดงผลแล้ว", ok: true });
    } catch (err: any) {
      setMessage({ text: `❌ ${err}`, ok: false });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  const btnBase: React.CSSProperties = {
    border: "none",
    borderRadius: 12,
    padding: "14px 0",
    fontSize: 16,
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.5 : 1,
    transition: "opacity 0.2s",
  };

  return (
    <div
      className="context-menu-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="context-menu"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 400 }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <h3 style={{ margin: 0 }}>🖥️ ตั้งค่าจอแสดงผล</h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "#fff",
              fontSize: 22,
              cursor: "pointer",
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Status badge */}
        <div
          style={{
            background: isEnabled ? "#0a3a0a" : "#2a2a2a",
            border: `1px solid ${isEnabled ? "#2d5a2d" : "#444"}`,
            borderRadius: 10,
            padding: "8px 14px",
            fontSize: 13,
            color: isEnabled ? "#6fcd6f" : "#888",
            marginBottom: 20,
          }}
        >
          {isEnabled ? "● จอแสดงผลเปิดใช้งาน (Dual Monitor)" : "○ ปิดใช้งาน (Single Monitor)"}
        </div>

        {/* Monitor picker */}
        {monitors.length === 0 ? (
          <p style={{ color: "#888", textAlign: "center", fontSize: 14 }}>
            กำลังโหลดรายการ monitor...
          </p>
        ) : (
          <>
            <label
              style={{ fontSize: 13, color: "#aaa", display: "block", marginBottom: 8 }}
            >
              เลือกจอแสดงผล (display monitor):
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {monitors.map((m, idx) => (
                <button
                  key={idx}
                  onClick={() => setDisplayIdx(idx)}
                  style={{
                    background: displayIdx === idx ? "#1a3a5a" : "#1e1e1e",
                    border: `2px solid ${displayIdx === idx ? "#4a8fc0" : "#333"}`,
                    borderRadius: 10,
                    padding: "12px 16px",
                    color: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {m.name || `Monitor ${idx + 1}`}
                      {m.isPrimary && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 11,
                            background: "#333",
                            padding: "1px 6px",
                            borderRadius: 6,
                            color: "#aaa",
                          }}
                        >
                          Primary
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                      {m.width}×{m.height} @ ({m.x}, {m.y})
                      {m.scaleFactor !== 1 && ` · ${m.scaleFactor}×`}
                    </div>
                  </div>
                  {displayIdx === idx && (
                    <span style={{ color: "#4a8fc0", fontSize: 18 }}>✓</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Message */}
        {message && (
          <p
            style={{
              fontSize: 13,
              color: message.ok ? "#6fcd6f" : "#ff8888",
              margin: "0 0 14px",
              textAlign: "center",
            }}
          >
            {message.text}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={loading || displayIdx < 0}
            style={{
              ...btnBase,
              flex: 1,
              background: "#1a5536",
              color: "#fff",
            }}
          >
            {loading ? "..." : "✅ เปิดจอแสดงผล"}
          </button>
          {isEnabled && (
            <button
              onClick={handleCloseDisplay}
              disabled={loading}
              style={{
                ...btnBase,
                flex: 1,
                background: "#4a1a1a",
                color: "#ff8888",
              }}
            >
              {loading ? "..." : "🚫 ปิดจอแสดงผล"}
            </button>
          )}
        </div>

        <button
          className="context-menu-item"
          style={{ marginTop: 12, justifyContent: "center", background: "#333" }}
          onClick={onClose}
        >
          ปิด
        </button>
      </div>
    </div>
  );
}
