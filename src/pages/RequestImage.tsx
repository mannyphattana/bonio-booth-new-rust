import React, { useState, useCallback } from "react";
import { appLogger } from "../utils/appLogger";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import type { ThemeData } from "../App";
import { setPrinting } from "../utils/printingState";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function RequestImage({ theme, onFormatReset, onBeforeClose }: Props): React.JSX.Element {
  const navigate = useNavigate();
  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();
  const [imageUrl, setImageUrl] = useState<string>("");
  const [copies, setCopies] = useState<number>(1);
  const [orientation, setOrientation] = useState<
    "portrait" | "landscape" | "portrait-cut" | "landscape-cut"
  >("portrait");
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<
    "idle" | "printing" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [imageError, setImageError] = useState<string>("");
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const handleCountdownComplete = useCallback(() => {
    appLogger.info(__CTX__, "[RequestImage] Countdown completed, auto-navigating to home");
    navigate("/");
  }, [navigate]);

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleImageUrlChange = (url: string) => {
    setImageUrl(url);
    setImageError("");
    setImageLoaded(false);
    setImageDimensions(null);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImageLoaded(true);
    setImageError("");
    setImageDimensions({ width: w, height: h });

    // à¸•à¸±à¹‰à¸‡ default orientation à¸•à¸²à¸¡à¸­à¸±à¸•à¸£à¸²à¸ªà¹ˆà¸§à¸™à¸£à¸¹à¸› (config à¸•à¸²à¸¡à¸‚à¸™à¸²à¸”à¸£à¸¹à¸›à¸—à¸µà¹ˆ paste/à¹‚à¸«à¸¥à¸”à¸¡à¸²)
    const ratio = w / h;
    if (ratio > 1) {
      setOrientation(ratio >= 2 ? "landscape-cut" : "landscape");
    } else if (ratio < 1) {
      setOrientation(ratio <= 0.5 ? "portrait-cut" : "portrait");
    } else {
      setOrientation("portrait");
    }
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError("à¹„à¸¡à¹ˆà¸ªà¸²à¸¡à¸²à¸£à¸–à¹‚à¸«à¸¥à¸”à¸£à¸¹à¸›à¸ à¸²à¸žà¹„à¸”à¹‰ à¸à¸£à¸¸à¸“à¸²à¸•à¸£à¸§à¸ˆà¸ªà¸­à¸š URL");
  };

  const handlePrint = async () => {
    if (isPrinting) return;

    if (!imageUrl.trim()) {
      setPrintStatus("error");
      setErrorMessage("à¸à¸£à¸¸à¸“à¸²à¸£à¸°à¸šà¸¸ URL à¸£à¸¹à¸›à¸ à¸²à¸ž");
      return;
    }

    if (!imageLoaded) {
      setPrintStatus("error");
      setErrorMessage("à¸à¸£à¸¸à¸“à¸²à¸£à¸­à¹ƒà¸«à¹‰à¸£à¸¹à¸›à¸ à¸²à¸žà¹‚à¸«à¸¥à¸”à¹€à¸ªà¸£à¹‡à¸ˆà¸à¹ˆà¸­à¸™");
      return;
    }

    // à¸”à¸¶à¸‡à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸›à¸£à¸´à¹‰à¸™à¸ˆà¸²à¸à¹à¸«à¸¥à¹ˆà¸‡à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸šà¸›à¸£à¸´à¹‰à¸™à¹€à¸—à¸ª (localStorage) â€” à¹„à¸¡à¹ˆà¹ƒà¸Šà¹‰à¹à¸„à¹ˆ state à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰à¹„à¸”à¹‰à¸„à¹ˆà¸²à¸—à¸µà¹ˆà¸•à¸±à¹‰à¸‡à¹„à¸§à¹‰à¹à¸¥à¹‰à¸§
    const selectedPrinter = localStorage.getItem("selectedPrinter") || "";
    if (!selectedPrinter) {
      setPrintStatus("error");
      setErrorMessage("à¹„à¸¡à¹ˆà¸žà¸šà¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œ à¸à¸£à¸¸à¸“à¸²à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¹€à¸„à¸£à¸·à¹ˆà¸­à¸‡à¸žà¸´à¸¡à¸žà¹Œà¸à¹ˆà¸­à¸™");
      return;
    }

    setIsPrinting(true);
    setPrintStatus("printing");
    setErrorMessage("");

    try {
      const isPortraitCut = orientation === "portrait-cut";
      const isLandscapeCut = orientation === "landscape-cut";

      // Determine frameType - Rust print_photo handles duplication for 2x6/6x2 internally
      let frameType = "4x6";
      let isLandscape = false;
      if (isPortraitCut) {
        frameType = "2x6";
      } else if (isLandscapeCut) {
        frameType = "6x2";
        isLandscape = true;
      } else if (orientation === "landscape") {
        frameType = "6x4";
        isLandscape = true;
      }

      // à¸”à¸¶à¸‡à¸à¸²à¸£à¸•à¸±à¹‰à¸‡à¸„à¹ˆà¸²à¸à¸²à¸£à¸›à¸£à¸´à¹‰à¸™à¸ˆà¸²à¸ config à¹€à¸«à¸¡à¸·à¸­à¸™à¸›à¸£à¸´à¹‰à¸™à¹€à¸—à¸ª/PhotoResult
      let scale = 100;
      let verticalOffset = 0;
      let horizontalOffset = 0;
      try {
        const configKey = isLandscape ? "paperConfigLandscape" : "paperConfigPortrait";
        const saved = localStorage.getItem(configKey);
        if (saved) {
          const config = JSON.parse(saved);
          const s = Number(config.scale);
          const v = Number(config.vertical);
          const h = Number(config.horizontal);
          if (!Number.isNaN(s)) scale = s;
          if (!Number.isNaN(v)) verticalOffset = v;
          if (!Number.isNaN(h)) horizontalOffset = h;
        }
      } catch {
        /* use defaults */
      }

      // à¹‚à¸«à¸¥à¸”à¸£à¸¹à¸›à¸ˆà¸²à¸ URL à¸—à¸²à¸‡ Rust (à¹„à¸¡à¹ˆà¸¡à¸µ CORS â€” à¹à¸à¹‰ "Failed to fetch" à¸ˆà¸²à¸ fetch à¹ƒà¸™à¹€à¸šà¸£à¸²à¸§à¹Œà¹€à¸‹à¸­à¸£à¹Œ)
      appLogger.info(__CTX__, "[RequestImage] Downloading image from URL via Rust...");
      const tempPath: string = await invoke("download_image_from_url", { url: imageUrl });
      appLogger.info(__CTX__, "[RequestImage] Image saved:", tempPath);

      // Set printing state BEFORE printing to prevent device check notifications
      // Calculate timeout: 30 seconds per copy + 30 seconds buffer
      const printTimeout = copies * 30000 + 30000;
      setPrinting(true, printTimeout);
      appLogger.info(__CTX__, `[RequestImage] Printing state set to true (${copies} copies, timeout: ${printTimeout}ms)`);
      
      // Small delay to ensure printing state is set before device check runs
      await new Promise(resolve => setTimeout(resolve, 100));

      try {
        // Print for each copy
        for (let i = 0; i < copies; i++) {
          appLogger.info(__CTX__, `[RequestImage] Printing copy ${i + 1}/${copies}...`);
          await invoke("print_photo", {
            imagePath: tempPath,
            printerName: selectedPrinter,
            frameType,
            scale,
            verticalOffset,
            horizontalOffset,
            isLandscape,
          });
        }

        // à¸¥à¸” paper level à¸—à¸µà¹ˆà¸«à¸¥à¸±à¸‡à¸šà¹‰à¸²à¸™ (à¹€à¸ªà¹‰à¸™à¹€à¸”à¸µà¸¢à¸§à¸à¸±à¸š bonio-booth: POST paper-level/reduce)
        try {
          await invoke("reduce_paper_level", { copies });
        } catch (e) {
          appLogger.warn(__CTX__, "[RequestImage] reduce_paper_level failed (non-blocking):", e);
        }

        appLogger.info(__CTX__, "[RequestImage] Print successful!");
        setPrintStatus("success");
      } catch (error) {
        appLogger.error(__CTX__, "[RequestImage] Error:", error);
        setPrintStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Unknown error occurred",
        );
      } finally {
        setIsPrinting(false);
        // Clear printing state after print completes (includes grace period)
        appLogger.info(__CTX__, "[RequestImage] Print completed, clearing printing state");
        setPrinting(false);
      }
    } catch (error) {
      appLogger.error(__CTX__, "[RequestImage] Error:", error);
      setPrintStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown error occurred",
      );
      setIsPrinting(false);
      // Clear printing state on error
      setPrinting(false);
    }
  };

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
      {/* Back button */}
      <BackButton onBackClick={handleBack} disabled={isPrinting} />

      {/* Countdown â€” visible only while printing or after success */}
      <Countdown
        seconds={600}
        onComplete={handleCountdownComplete}
        visible={isPrinting || printStatus === "success"}
      />

      {/* Header */}
      <div
        style={{
          padding: "60px 30px 10px 30px",
          textAlign: "center",
        }}
      >
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 700,
            margin: 0,
            color: theme?.fontColor || "#2c2c2c",
          }}
        >
          à¸›à¸£à¸´à¹‰à¸™à¸¢à¹‰à¸­à¸™à¸«à¸¥à¸±à¸‡
        </h1>
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "10px 30px 30px 30px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Image URL Input */}
        <div>
          <h2
            style={{
              fontSize: "1.2rem",
              fontWeight: 600,
              margin: "0 0 8px 0",
              color: theme?.fontColor || "#2c2c2c",
            }}
          >
            à¸£à¸°à¸šà¸¸ URL à¸£à¸¹à¸›à¸ à¸²à¸ž
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => handleImageUrlChange(e.target.value)}
              placeholder="https://example.com/image.jpg"
              disabled={isPrinting}
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: "1rem",
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                outline: "none",
                boxSizing: "border-box",
                background: "white",
                color: "#2c2c2c",
              }}
            />
            {imageError && (
              <p style={{ color: "#e53e3e", fontSize: "0.9rem", margin: 0 }}>
                {imageError}
              </p>
            )}
          </div>
        </div>

        {/* Image Preview */}
        {imageUrl && (
          <div>
            <h2
              style={{
                fontSize: "1.2rem",
                fontWeight: 600,
                margin: "0 0 8px 0",
                color: theme?.fontColor || "#2c2c2c",
              }}
            >
              Preview à¸£à¸¹à¸›à¸ à¸²à¸ž
            </h2>
            <div
              style={{
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                overflow: "hidden",
                background: "#f9f9f9",
                minHeight: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {!imageLoaded && !imageError && (
                <div style={{ textAlign: "center", padding: 20 }}>
                  <div className="loading-spinner" />
                  <p style={{ marginTop: 8, color: "#666" }}>
                    à¸à¸³à¸¥à¸±à¸‡à¹‚à¸«à¸¥à¸”à¸£à¸¹à¸›à¸ à¸²à¸ž...
                  </p>
                </div>
              )}
              {imageError && (
                <p style={{ color: "#e53e3e", padding: 20 }}>âŒ {imageError}</p>
              )}
              <img
                src={imageUrl}
                alt="Preview"
                onLoad={handleImageLoad}
                onError={handleImageError}
                style={{
                  display: imageLoaded ? "block" : "none",
                  maxWidth: "100%",
                  maxHeight: 300,
                  objectFit: "contain",
                }}
              />
            </div>
          </div>
        )}

        {/* Print Settings */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            background: "rgba(255,255,255,0.85)",
            borderRadius: 12,
            padding: 20,
          }}
        >
          {/* Copies */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <label
              htmlFor="copies"
              style={{
                fontSize: "1rem",
                fontWeight: 600,
                color: "#2c2c2c",
              }}
            >
              à¸ˆà¸³à¸™à¸§à¸™à¸—à¸µà¹ˆà¸ˆà¸°à¸žà¸´à¸¡à¸žà¹Œ:
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                onClick={() => setCopies(Math.max(1, copies - 1))}
                disabled={isPrinting || copies <= 1}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "2px solid #e0e0e0",
                  background: "white",
                  fontSize: "1.2rem",
                  cursor: copies <= 1 ? "not-allowed" : "pointer",
                  opacity: copies <= 1 ? 0.4 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                âˆ’
              </button>
              <span
                style={{
                  fontSize: "1.4rem",
                  fontWeight: 700,
                  minWidth: 32,
                  textAlign: "center",
                  color: "#2c2c2c",
                }}
              >
                {copies}
              </span>
              <button
                type="button"
                onClick={() => setCopies(Math.min(5, copies + 1))}
                disabled={isPrinting || copies >= 5}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  border: "2px solid #e0e0e0",
                  background: "white",
                  fontSize: "1.2rem",
                  cursor: copies >= 5 ? "not-allowed" : "pointer",
                  opacity: copies >= 5 ? 0.4 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* à¸‚à¸™à¸²à¸”à¸£à¸¹à¸› + Orientation */}
          {imageDimensions && (
            <div
              style={{
                fontSize: "0.9rem",
                color: "#666",
              }}
            >
              à¸‚à¸™à¸²à¸”à¸£à¸¹à¸›: {imageDimensions.width} Ã— {imageDimensions.height} px
            </div>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <label
              htmlFor="orientation"
              style={{ fontSize: "1rem", fontWeight: 600, color: "#2c2c2c" }}
            >
              Orientation:
            </label>
            <select
              id="orientation"
              value={orientation}
              onChange={(e) =>
                setOrientation(
                  e.target.value as
                    | "portrait"
                    | "landscape"
                    | "portrait-cut"
                    | "landscape-cut",
                )
              }
              disabled={isPrinting}
              style={{
                padding: "8px 12px",
                fontSize: "1rem",
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                background: "white",
                color: "#2c2c2c",
                cursor: "pointer",
              }}
            >
              <option value="portrait">Portrait (à¸•à¸±à¹‰à¸‡) 4x6</option>
              <option value="portrait-cut">Portrait Cut (à¸•à¸±à¹‰à¸‡-à¸•à¸±à¸”) 2x6</option>
              <option value="landscape">Landscape (à¸™à¸­à¸™) 6x4</option>
              <option value="landscape-cut">Landscape Cut (à¸™à¸­à¸™-à¸•à¸±à¸”) 6x2</option>
            </select>
          </div>

          {/* Print Status */}
          {printStatus === "printing" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#2c2c2c",
              }}
            >
              <div className="loading-spinner" />
              <p style={{ margin: 0 }}>à¸à¸³à¸¥à¸±à¸‡à¸žà¸´à¸¡à¸žà¹Œ...</p>
            </div>
          )}
          {printStatus === "success" && (
            <p style={{ color: "#38a169", fontWeight: 600, margin: 0 }}>
              âœ… à¸žà¸´à¸¡à¸žà¹Œà¸ªà¸³à¹€à¸£à¹‡à¸ˆ!
            </p>
          )}
          {printStatus === "error" && (
            <div>
              <p style={{ color: "#e53e3e", fontWeight: 600, margin: 0 }}>
                âŒ à¸žà¸´à¸¡à¸žà¹Œà¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ
              </p>
              {errorMessage && (
                <p
                  style={{
                    color: "#e53e3e",
                    fontSize: "0.85rem",
                    margin: "4px 0 0 0",
                  }}
                >
                  {errorMessage}
                </p>
              )}
            </div>
          )}

          {/* Print Button */}
          <button
            type="button"
            onClick={handlePrint}
            disabled={isPrinting || !imageUrl.trim() || !imageLoaded}
            className="primary-button"
            style={{
              opacity: isPrinting || !imageUrl.trim() || !imageLoaded ? 0.5 : 1,
              cursor:
                isPrinting || !imageUrl.trim() || !imageLoaded
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isPrinting ? "à¸à¸³à¸¥à¸±à¸‡à¸žà¸´à¸¡à¸žà¹Œ..." : `à¸žà¸´à¸¡à¸žà¹Œ ${copies} à¹à¸œà¹ˆà¸™`}
          </button>
        </div>
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

