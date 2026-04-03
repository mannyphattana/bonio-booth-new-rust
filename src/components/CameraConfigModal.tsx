import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface WebcamDevice {
  deviceId: string;
  label: string;
}

interface DslrCamera {
  name: string;
  device_id: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CameraConfigModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<"webcam" | "canon">("webcam");
  const [webcams, setWebcams] = useState<WebcamDevice[]>([]);
  const [dslrCameras, setDslrCameras] = useState<DslrCamera[]>([]);
  const [selectedWebcam, setSelectedWebcam] = useState<string>("");
  const [selectedDslr, setSelectedDslr] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  // Load current config from localStorage
  useEffect(() => {
    if (!open) return;
    const savedType = localStorage.getItem("cameraType") || "webcam";
    const normalizedType = savedType === "webcam" ? "webcam" : "canon";
    if (normalizedType !== savedType) {
      localStorage.setItem("cameraType", normalizedType);
    }
    setTab(normalizedType);
    setSelectedWebcam(localStorage.getItem("selectedWebcamId") || "");
    setSelectedDslr(localStorage.getItem("selectedCameraName") || "");
    setSavedMessage("");
  }, [open]);

  // List webcams
  const loadWebcams = useCallback(async () => {
    try {
      // Request permission first to get labels
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied or no camera
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        }));
      setWebcams(videoDevices);
    } catch {
      setWebcams([]);
    }
  }, []);

  // List DSLR cameras
  const loadDslrCameras = useCallback(async () => {
    setLoading(true);
    try {
      const cameras: DslrCamera[] = await invoke("list_dslr_cameras");
      setDslrCameras(cameras);
    } catch {
      setDslrCameras([]);
    }
    setLoading(false);
  }, []);

  // Load devices when tab changes
  useEffect(() => {
    if (!open) return;
    if (tab === "webcam") {
      loadWebcams();
    } else {
      loadDslrCameras();
    }
  }, [tab, open, loadWebcams, loadDslrCameras]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("set_camera_type", { cameraType: tab });
      localStorage.setItem("cameraType", tab);

      if (tab === "webcam") {
        await invoke("set_selected_webcam", { webcamId: selectedWebcam });
        localStorage.setItem("selectedWebcamId", selectedWebcam);
        const device = webcams.find((w) => w.deviceId === selectedWebcam);
        localStorage.setItem("selectedCameraLabel", device?.label || "");
      } else {
        await invoke("set_selected_camera_name", { cameraName: selectedDslr });
        localStorage.setItem("selectedCameraName", selectedDslr);
      }

      setSavedMessage("✅ บันทึกสำเร็จ!");
      setTimeout(() => setSavedMessage(""), 2000);
    } catch (err) {
      setSavedMessage("❌ บันทึกไม่สำเร็จ");
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="config-modal-overlay" onClick={onClose}>
      <div className="config-modal" onClick={(e) => e.stopPropagation()}>
        <div className="config-modal-header">
          <h3>📷 Camera Config</h3>
          <button className="config-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* Tab selector */}
        <div className="config-tabs">
          <button
            className={`config-tab ${tab === "webcam" ? "active" : ""}`}
            onClick={() => setTab("webcam")}
          >
            🎥 Webcam
          </button>
          <button
            className={`config-tab ${tab === "canon" ? "active" : ""}`}
            onClick={() => setTab("canon")}
          >
            📸 Canon / DSLR
          </button>
        </div>

        <div className="config-body">
          {tab === "webcam" ? (
            <>
              <p className="config-label">เลือก Webcam / Select Webcam</p>
              {webcams.length === 0 ? (
                <div className="config-empty">
                  ⚠️ ไม่พบ Webcam / No webcam found
                </div>
              ) : (
                <div className="config-device-list">
                  {webcams.map((cam) => (
                    <button
                      key={cam.deviceId}
                      className={`config-device-item ${selectedWebcam === cam.deviceId ? "selected" : ""}`}
                      onClick={() => setSelectedWebcam(cam.deviceId)}
                    >
                      <span className="config-device-icon">🎥</span>
                      <span className="config-device-name">{cam.label}</span>
                      {selectedWebcam === cam.deviceId && (
                        <span className="config-device-check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <button className="config-refresh-btn" onClick={loadWebcams}>
                🔄 Refresh
              </button>
            </>
          ) : (
            <>
              <p className="config-label">เลือกกล้อง DSLR / Select DSLR Camera</p>
              {loading ? (
                <div className="config-empty">กำลังค้นหากล้อง...</div>
              ) : dslrCameras.length === 0 ? (
                <div className="config-empty">
                  ⚠️ ไม่พบกล้อง DSLR / No DSLR camera found
                  <br />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    กรุณาเชื่อมต่อกล้องผ่าน USB และเปิดโหมด PTP
                  </span>
                </div>
              ) : (
                <div className="config-device-list">
                  {dslrCameras.map((cam) => (
                    <button
                      key={cam.device_id}
                      className={`config-device-item ${selectedDslr === cam.name ? "selected" : ""}`}
                      onClick={() => setSelectedDslr(cam.name)}
                    >
                      <span className="config-device-icon">📸</span>
                      <span className="config-device-name">{cam.name}</span>
                      {selectedDslr === cam.name && (
                        <span className="config-device-check">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <button className="config-refresh-btn" onClick={loadDslrCameras}>
                🔄 Refresh
              </button>
            </>
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
            disabled={saving || (tab === "webcam" ? !selectedWebcam : !selectedDslr)}
          >
            {saving ? "กำลังบันทึก..." : "💾 บันทึก / Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
