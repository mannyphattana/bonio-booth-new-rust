import { useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import BackButton from "../components/BackButton";
import outOfPaperImg from "../assets/images/out-of-paper.png";
import { REFETCH_INTERVAL } from "../config/appConfig";
import type { ThemeData } from "../App";

interface Props {
  theme: ThemeData;
  lineUrl: string;
}

export default function OutOfPaper({ theme, lineUrl }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMaintenanceMode = location.state?.maintenance;

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Poll machine data when auto-redirected (maintenance/out-of-paper mode)
  useEffect(() => {
    if (!isMaintenanceMode) return;

    const interval = setInterval(async () => {
      try {
        const res: any = await invoke("init_machine");
        if (res.success && res.data?.machine) {
          if (res.data.machine.isMaintenanceMode) {
            // Maintenance turned on — redirect to maintenance
            navigate("/", { state: { maintenance: true } });
          } else if (res.data.machine.paperLevel !== 0) {
            // Paper refilled — go home
            navigate("/");
          }
        }
      } catch (error) {
        console.error("[OutOfPaper] Polling error:", error);
      }
    }, REFETCH_INTERVAL.OUT_OF_PAPER * 1000);

    return () => clearInterval(interval);
  }, [isMaintenanceMode, navigate]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundImage: theme?.backgroundSecond
          ? `url(${theme.backgroundSecond})`
          : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        color: theme?.fontColor || "#2c2c2c",
      }}
    >
      {/* Back button — hidden in maintenance/auto-redirect mode */}
      {!isMaintenanceMode && <BackButton onBackClick={handleBack} />}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          overflowY: "auto",
          textAlign: "center",
        }}
      >
        {/* Illustration */}
        <div
          style={{
            margin: "20px 0 30px 0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "50%",
          }}
        >
          <img src={outOfPaperImg} alt="Out of Paper" width="100%" />
        </div>

        {/* Title */}
        <h1
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            margin: "0 0 5px 0",
            color: theme?.fontColor || "#2c2c2c",
          }}
        >
          OUT OF PAPER
        </h1>

        {/* Instruction */}
        <p
          style={{
            fontSize: "1.5rem",
            lineHeight: 1.6,
            margin: "0 0 10px 0",
            maxWidth: 600,
            color: theme?.fontColor || "#2c2c2c",
          }}
        >
          ขออภัยในความไม่สะดวก
          <br />
          กรุณาติดต่อพนักงาน หรือแอดไลน์ เพื่อแจ้งแอดมิน
        </p>

        {/* QR Code */}
        {lineUrl && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              margin: "20px 0",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 15,
              }}
            >
              <QRCodeSVG
                value={lineUrl}
                size={200}
                level="M"
                style={{
                  border: "3px solid #2c2c2c",
                  borderRadius: 8,
                  padding: 10,
                  background: "white",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
