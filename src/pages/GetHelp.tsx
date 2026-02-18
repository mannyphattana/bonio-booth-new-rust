import { useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import getHelpImage from "../assets/images/get-help.png";
import type { ThemeData } from "../App";

interface Props {
  theme: ThemeData;
  lineUrl: string;
}

export default function GetHelp({ theme, lineUrl }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const isMaintenanceMode = location.state?.maintenance;

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleCountdownComplete = useCallback(() => {
    handleBack();
  }, [handleBack]);

  // Inline styles based on legacy CSS
  const containerStyle: React.CSSProperties = {
    width: "100vw",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundImage: theme?.backgroundSecond
      ? `url(${theme.backgroundSecond})`
      : "none",
    backgroundColor: "#000",
    color: theme?.fontColor || "#fff",
    position: "relative",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };

  const illustrationStyle: React.CSSProperties = {
    margin: "20px 0 30px 0",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: "50%",
    maxWidth: "400px",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "3rem",
    fontWeight: 700,
    margin: "0 0 5px 0",
    color: theme?.fontColor || "#fff",
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: "1.5rem",
    fontWeight: 600,
    margin: "0 0 30px 0",
    letterSpacing: "1px",
    color: theme?.fontColor || "#ccc",
    opacity: 0.8,
  };

  const instructionThaiStyle: React.CSSProperties = {
    fontSize: "1.5rem",
    lineHeight: 1.6,
    marginBottom: "10px",
    maxWidth: "600px",
    color: theme?.fontColor || "#fff",
  };

  const instructionEnStyle: React.CSSProperties = {
    fontSize: "16px",
    lineHeight: 1.6,
    marginBottom: "40px",
    maxWidth: "600px",
    color: theme?.fontColor || "#ccc",
    opacity: 0.8,
  };

  const qrSectionStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    margin: "20px 0",
  };

  const qrContainerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "15px",
    padding: "10px",
    backgroundColor: "#fff",
    borderRadius: "8px",
    border: "3px solid #2c2c2c",
  };

  return (
    <div style={containerStyle}>
      {!isMaintenanceMode && <BackButton onBackClick={handleBack} />}

      {!isMaintenanceMode && (
        <Countdown
          seconds={COUNTDOWN.GET_HELP.DURATION}
          onComplete={handleCountdownComplete}
          visible={COUNTDOWN.GET_HELP.VISIBLE}
        />
      )}

      <div
        className="page-content"
        style={{ overflowY: "auto", padding: "20px", textAlign: "center" }}
      >
        <div style={illustrationStyle}>
          <img src={getHelpImage} alt="Get Help" width="100%" height="auto" />
        </div>

        <h1 style={titleStyle}>ติดต่อขอความช่วยเหลือ</h1>
        <p style={subtitleStyle}>GET HELP</p>

        <p style={instructionThaiStyle}>
          สแกน Line QR ด้านล่างเพื่อขอความช่วยเหลือเพิ่มเติม
        </p>
        <p style={instructionEnStyle}>
          Scan the Line QR code below for support.
        </p>

        <div style={qrSectionStyle}>
          <div style={qrContainerStyle}>
            {lineUrl ? (
              <QRCodeSVG value={lineUrl} size={200} level="M" />
            ) : (
              <div
                style={{
                  width: 200,
                  height: 200,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#000",
                }}
              >
                Loading...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
