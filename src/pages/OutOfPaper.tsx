import { useCallback, useEffect } from "react";
import { appLogger } from "../utils/appLogger";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import BackButton from "../components/BackButton";
import outOfPaperImg from "../assets/images/out-of-paper.png";
import { REFETCH_INTERVAL } from "../config/appConfig";
import type { ThemeData } from "../App";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  lineUrl: string;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
  /** à¹‚à¸«à¸¡à¸” overlay à¸ˆà¸²à¸ App (maintenance à¸à¸£à¸°à¸”à¸²à¸©à¸«à¸¡à¸”) â€” à¸‹à¹ˆà¸­à¸™à¸›à¸¸à¹ˆà¸¡à¸à¸¥à¸±à¸š à¹à¸¥à¸°à¹‚à¸žà¸¥à¹à¸¥à¹‰à¸§à¹€à¸£à¸µà¸¢à¸ onPaperRefilled à¹€à¸¡à¸·à¹ˆà¸­à¸à¸£à¸°à¸”à¸²à¸©à¹€à¸•à¸´à¸¡ */
  isOverlay?: boolean;
  onPaperRefilled?: () => void;
}

export default function OutOfPaper({
  theme,
  lineUrl,
  onFormatReset,
  onBeforeClose,
  isOverlay = false,
  onPaperRefilled,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMaintenanceMode = location.state?.maintenance;
  const shouldHideBackAndPoll = isOverlay || isMaintenanceMode;

  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Poll machine data when auto-redirected (maintenance/out-of-paper) or overlay (à¸à¸£à¸°à¸”à¸²à¸©à¸«à¸¡à¸”à¸ˆà¸²à¸ init)
  useEffect(() => {
    if (!shouldHideBackAndPoll) return;

    const interval = setInterval(async () => {
      try {
        const res: any = await invoke("init_machine");
        if (res.success && res.data) {
          const paperLevel = res.data.paperLevel ?? res.data.machine?.paperLevel;
          const isMaintenanceModeBackend = res.data.machine?.isMaintenanceMode;
          if (isMaintenanceMode && isMaintenanceModeBackend) {
            // Maintenance turned on â€” redirect to maintenance
            navigate("/", { state: { maintenance: true } });
          } else if (paperLevel !== 0 && paperLevel !== undefined) {
            // Paper refilled
            if (isOverlay && onPaperRefilled) {
              onPaperRefilled();
            } else {
              navigate("/");
            }
          }
        }
      } catch (error) {
        appLogger.error(__CTX__, "[OutOfPaper] Polling error:", error);
      }
    }, REFETCH_INTERVAL.OUT_OF_PAPER * 1000);

    return () => clearInterval(interval);
  }, [shouldHideBackAndPoll, isOverlay, isMaintenanceMode, onPaperRefilled, navigate]);

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
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      {/* Back button â€” hidden in overlay mode or maintenance/auto-redirect */}
      {!shouldHideBackAndPoll && <BackButton onBackClick={handleBack} />}

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
          à¸‚à¸­à¸­à¸ à¸±à¸¢à¹ƒà¸™à¸„à¸§à¸²à¸¡à¹„à¸¡à¹ˆà¸ªà¸°à¸”à¸§à¸
          <br />
          à¸à¸£à¸¸à¸“à¸²à¸•à¸´à¸”à¸•à¹ˆà¸­à¸žà¸™à¸±à¸à¸‡à¸²à¸™ à¸«à¸£à¸·à¸­à¹à¸­à¸”à¹„à¸¥à¸™à¹Œ à¹€à¸žà¸·à¹ˆà¸­à¹à¸ˆà¹‰à¸‡à¹à¸­à¸”à¸¡à¸´à¸™
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
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}

