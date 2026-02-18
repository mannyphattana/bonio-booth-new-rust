import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import BackButton from "../components/BackButton";
import Countdown from "../components/Countdown";
import type { ThemeData } from "../App";

interface Props {
  theme: ThemeData;
}

export default function RequestImage({ theme }: Props): React.JSX.Element {
  const navigate = useNavigate();
  const [imageUrl, setImageUrl] = useState<string>("");
  const [copies, setCopies] = useState<number>(1);
  const [orientation, setOrientation] = useState<
    "portrait" | "landscape" | "portrait-cut"
  >("portrait");
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<
    "idle" | "printing" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [imageError, setImageError] = useState<string>("");
  const [imageLoaded, setImageLoaded] = useState<boolean>(false);
  const [printerName, setPrinterName] = useState<string>("");

  // Load selected printer from Rust AppState
  useEffect(() => {
    const loadPrinter = async () => {
      try {
        const name: string = await invoke("get_selected_printer");
        if (name) setPrinterName(name);
      } catch (err) {
        console.error("[RequestImage] Failed to get printer:", err);
      }
    };
    loadPrinter();
  }, []);

  const handleCountdownComplete = useCallback(() => {
    console.log("[RequestImage] Countdown completed, auto-navigating to home");
    navigate("/");
  }, [navigate]);

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  const handleImageUrlChange = (url: string) => {
    setImageUrl(url);
    setImageError("");
    setImageLoaded(false);
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageError("");
  };

  const handleImageError = () => {
    setImageLoaded(false);
    setImageError("ไม่สามารถโหลดรูปภาพได้ กรุณาตรวจสอบ URL");
  };

  const convertImageUrlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handlePrint = async () => {
    if (isPrinting) return;

    if (!imageUrl.trim()) {
      setPrintStatus("error");
      setErrorMessage("กรุณาระบุ URL รูปภาพ");
      return;
    }

    if (!imageLoaded) {
      setPrintStatus("error");
      setErrorMessage("กรุณารอให้รูปภาพโหลดเสร็จก่อน");
      return;
    }

    if (!printerName) {
      setPrintStatus("error");
      setErrorMessage("ไม่พบเครื่องพิมพ์ กรุณาตั้งค่าเครื่องพิมพ์ก่อน");
      return;
    }

    setIsPrinting(true);
    setPrintStatus("printing");
    setErrorMessage("");

    try {
      console.log("[RequestImage] Converting image URL to base64...");
      let imageBase64 = await convertImageUrlToBase64(imageUrl);

      const isPortraitCut = orientation === "portrait-cut";

      // For portrait-cut (2x6): duplicate image side-by-side to make 4x6
      if (isPortraitCut) {
        console.log("[RequestImage] Duplicating image for 2x6 -> 4x6...");
        const doubleCanvas = document.createElement("canvas");
        const img = new Image();

        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            const frameWidth = 1200;
            const frameHeight = 3600;
            doubleCanvas.width = frameWidth * 2;
            doubleCanvas.height = frameHeight;
            const dCtx = doubleCanvas.getContext("2d", { colorSpace: "srgb" });
            if (dCtx) {
              dCtx.fillStyle = "#ffffff";
              dCtx.fillRect(0, 0, doubleCanvas.width, doubleCanvas.height);
              dCtx.drawImage(img, 0, 0, frameWidth, frameHeight);
              dCtx.drawImage(img, frameWidth, 0, frameWidth, frameHeight);
              imageBase64 = doubleCanvas.toDataURL("image/jpeg", 1.0);
              resolve();
            } else {
              reject(new Error("Failed to get canvas context"));
            }
          };
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = imageBase64;
        });
      }

      // Save base64 image to temp file via Rust
      console.log("[RequestImage] Saving image to temp file...");
      const tempPath: string = await invoke("save_temp_image", {
        imageDataBase64: imageBase64,
        filename: "request-image-print.jpg",
      });
      console.log("[RequestImage] Temp file saved:", tempPath);

      const isLandscape = orientation === "landscape";
      const frameType = isLandscape ? "6x4" : "4x6";

      // Print for each copy
      for (let i = 0; i < copies; i++) {
        console.log(`[RequestImage] Printing copy ${i + 1}/${copies}...`);
        await invoke("print_photo", {
          imagePath: tempPath,
          printerName,
          frameType,
          scale: 100.0,
          verticalOffset: 0.0,
          horizontalOffset: 0.0,
          isLandscape,
        });
      }

      console.log("[RequestImage] Print successful!");
      setPrintStatus("success");
    } catch (error) {
      console.error("[RequestImage] Error:", error);
      setPrintStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Unknown error occurred",
      );
    } finally {
      setIsPrinting(false);
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
    >
      {/* Back button */}
      <BackButton onBackClick={handleBack} disabled={isPrinting} />

      {/* Countdown — visible only while printing or after success */}
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
          ปริ้นย้อนหลัง
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
            ระบุ URL รูปภาพ
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
              Preview รูปภาพ
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
                    กำลังโหลดรูปภาพ...
                  </p>
                </div>
              )}
              {imageError && (
                <p style={{ color: "#e53e3e", padding: 20 }}>❌ {imageError}</p>
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
              จำนวนที่จะพิมพ์:
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
                −
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

          {/* Orientation */}
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
                  e.target.value as "portrait" | "landscape" | "portrait-cut",
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
              <option value="portrait">Portrait (ตั้ง) 4x6</option>
              <option value="portrait-cut">Portrait Cut (ตั้ง-ตัด) 2x6</option>
              <option value="landscape">Landscape (นอน) 6x4</option>
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
              <p style={{ margin: 0 }}>กำลังพิมพ์...</p>
            </div>
          )}
          {printStatus === "success" && (
            <p style={{ color: "#38a169", fontWeight: 600, margin: 0 }}>
              ✅ พิมพ์สำเร็จ!
            </p>
          )}
          {printStatus === "error" && (
            <div>
              <p style={{ color: "#e53e3e", fontWeight: 600, margin: 0 }}>
                ❌ พิมพ์ไม่สำเร็จ
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
            {isPrinting ? "กำลังพิมพ์..." : `พิมพ์ ${copies} แผ่น`}
          </button>
        </div>
      </div>
    </div>
  );
}
