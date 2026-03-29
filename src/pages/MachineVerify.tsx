import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onVerified: (data: any) => void;
}

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? "https://api-booth.boniolabs.com/api"
  : "http://localhost:3000/api";
const DEFAULT_MACHINE_ID = "69b1938827766fd8efb50396";
const DEFAULT_MACHINE_PORT = "33332";
const FORCE_TEST_MACHINE_CONFIG = !import.meta.env.DEV;

const getBackendMessage = (payload: any): string => {
  return (
    payload?.error ||
    payload?.data?.message ||
    payload?.data?.error ||
    "Unknown backend error"
  );
};

export default function MachineVerify({ onVerified }: Props) {
  const [machineId, setMachineId] = useState(
    FORCE_TEST_MACHINE_CONFIG
      ? DEFAULT_MACHINE_ID
      : localStorage.getItem("machineId") || DEFAULT_MACHINE_ID
  );
  const [machinePort, setMachinePort] = useState(
    FORCE_TEST_MACHINE_CONFIG
      ? DEFAULT_MACHINE_PORT
      : localStorage.getItem("machinePort") || DEFAULT_MACHINE_PORT
  );
  const [apiBaseUrl, setApiBaseUrl] = useState(
    FORCE_TEST_MACHINE_CONFIG
      ? DEFAULT_API_BASE_URL
      : localStorage.getItem("apiBaseUrl") || DEFAULT_API_BASE_URL,
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
      const actualMachineId = FORCE_TEST_MACHINE_CONFIG ? DEFAULT_MACHINE_ID : machineId;
      const actualMachinePort = FORCE_TEST_MACHINE_CONFIG ? DEFAULT_MACHINE_PORT : machinePort;
      const actualApiBaseUrl = FORCE_TEST_MACHINE_CONFIG ? DEFAULT_API_BASE_URL : apiBaseUrl;

      await invoke("set_machine_config", {
        machineId: actualMachineId,
        machinePort: actualMachinePort,
        machineApiBaseUrl: actualApiBaseUrl,
      });

      const verifyResult: any = await invoke("verify_machine", { machineId: actualMachineId });
      console.log("[MachineVerify] verify result:", {
        url: `${actualApiBaseUrl}/machines-public/verify?machineId=${actualMachineId}&port=${actualMachinePort}`,
        statusCode: verifyResult?.data?.statusCode,
        body: verifyResult?.data,
      });
      if (!verifyResult.success) {
        setError(getBackendMessage(verifyResult));
        setLoading(false);
        return;
      }

      const initResult: any = await invoke("init_machine");
      console.log("[MachineVerify] init result:", {
        url: `${actualApiBaseUrl}/machines-public/init?machineId=${actualMachineId}&port=${actualMachinePort}`,
        statusCode: initResult?.data?.statusCode,
        body: initResult?.data,
      });
      if (initResult.success && initResult.data?.machine) {
        localStorage.setItem("machineId", actualMachineId);
        localStorage.setItem("machinePort", actualMachinePort);
        localStorage.setItem("apiBaseUrl", actualApiBaseUrl);
        onVerified(initResult.data);
      } else {
        setError(getBackendMessage(initResult));
      }
    } catch (err: any) {
      setError(err?.message || err?.toString() || "Connection error");
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
        <label style={{ fontSize: 14, color: "#ccc" }}>API Base URL</label>
        <input
          type="text"
          value={apiBaseUrl}
          onChange={(e) => setApiBaseUrl(e.target.value)}
          placeholder="http://localhost:3000/api"
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
