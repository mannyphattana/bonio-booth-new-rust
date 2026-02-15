import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onVerified: (data: any) => void;
}

export default function MachineVerify({ onVerified }: Props) {
  const [machineId, setMachineId] = useState(
    localStorage.getItem("machineId") || ""
  );
  const [machinePort, setMachinePort] = useState(
    localStorage.getItem("machinePort") || "44444"
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!machineId.trim()) {
      setError("กรุณาใส่ Machine ID");
      return;
    }
    setLoading(true);
    setError("");

    try {
      await invoke("set_machine_config", { machineId, machinePort });

      const verifyResult: any = await invoke("verify_machine", { machineId });
      if (!verifyResult.success) {
        setError("Machine verification failed. Please check your Machine ID.");
        setLoading(false);
        return;
      }

      const initResult: any = await invoke("init_machine");
      if (initResult.success && initResult.data?.machine) {
        localStorage.setItem("machineId", machineId);
        localStorage.setItem("machinePort", machinePort);
        onVerified(initResult.data);
      } else {
        setError("Machine init failed. Please try again.");
      }
    } catch (err: any) {
      setError(err?.toString() || "Connection error");
    }
    setLoading(false);
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "linear-gradient(135deg, #0f0c29, #302b63, #24243e)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      }}
    >
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Bonio Booth</h1>
      <p style={{ color: "#aaa", fontSize: 14, marginBottom: 16 }}>
        Machine Verification
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 360 }}>
        <label style={{ fontSize: 14, color: "#ccc" }}>Machine ID</label>
        <input
          type="text"
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          placeholder="Enter Machine ID..."
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #444",
            background: "#1a1a2e",
            color: "#fff",
            fontSize: 16,
            outline: "none",
          }}
        />

        <label style={{ fontSize: 14, color: "#ccc", marginTop: 8 }}>Port</label>
        <input
          type="text"
          value={machinePort}
          onChange={(e) => setMachinePort(e.target.value)}
          placeholder="44444"
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            border: "1px solid #444",
            background: "#1a1a2e",
            color: "#fff",
            fontSize: 16,
            outline: "none",
          }}
        />

        {error && (
          <p style={{ color: "#e94560", fontSize: 14, textAlign: "center" }}>
            {error}
          </p>
        )}

        <button
          onClick={handleVerify}
          disabled={loading}
          style={{
            marginTop: 16,
            padding: "16px 32px",
            borderRadius: 12,
            background: loading ? "#444" : "#e94560",
            color: "#fff",
            fontSize: 18,
            fontWeight: 700,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Verifying..." : "Verify & Connect"}
        </button>
      </div>
    </div>
  );
}
