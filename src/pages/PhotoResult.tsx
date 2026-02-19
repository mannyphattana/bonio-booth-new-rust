import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import { setPrinting } from "../utils/printingState";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function PhotoResult({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};

  // ดึงข้อมูลรูปภาพและเฟรมเพื่อมาโชว์ทันที
  const frameCaptures: Capture[] = state.frameCaptures || [];
  const selectedFrame = state.selectedFrame;
  const selectedFilter = state.selectedFilter;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];

  // คำนวณขนาด Frame สำหรับจัด Layout และ Aspect Ratio
  const [_imgW, _imgH] = (selectedFrame?.imageSize || "")
    .split("x")
    .map(Number);
  const frameWidth = (_imgW > 0 ? _imgW : selectedFrame?.grid?.width) || 1200;
  const frameHeight = (_imgH > 0 ? _imgH : selectedFrame?.grid?.height) || 1800;
  const frameAspectRatioCSS = `${frameWidth} / ${frameHeight}`;

  // States สำหรับการทำงานเบื้องหลัง
  const [composedImage, setComposedImage] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [uploadUrls, setUploadUrls] = useState<any[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string>("processing");
  const [printStatus, setPrintStatus] = useState<string>("idle");
  const [, setError] = useState("");
  const [statusText, setStatusText] = useState("กำลังเตรียมข้อมูล...");

  const hasStarted = useRef(false);
  const hasCreatedPresign = useRef(false);
  const hasUploadedFiles = useRef(false);
  useIdleTimeout();

  // ====================================================================
  // Logic 1: Compose frame image (รันเบื้องหลังเพื่อเอาไปปริ้นท์/อัปโหลด)
  // ====================================================================
  const composeFrame = useCallback(async () => {
    try {
      setStatusText("กำลังประมวลผลรูปภาพ...");
      const photosBase64 = frameCaptures.map((c: Capture) => c.photo);

      const result: string = await invoke("compose_frame", {
        frameImageUrl: selectedFrame?.imageUrl || "",
        photosBase64,
        slots: slots,
        frameWidth: frameWidth,
        frameHeight: frameHeight,
      });

      setComposedImage(result);
      return result;
    } catch (err) {
      console.error("Compose frame error:", err);
      setError("Failed to compose frame");
      return "";
    }
  }, [frameCaptures, selectedFrame, slots, frameWidth, frameHeight]);

  // ====================================================================
  // Logic 2: Create presigned upload session (รันเบื้องหลัง)
  // ====================================================================
  useEffect(() => {
    if (hasCreatedPresign.current) return;
    const transactionId =
      state.transactionId || state.referenceId || state.transaction_id || "";

    if (!transactionId) {
      console.error(
        "❌ No transactionId found! Cannot create presign session.",
      );
      // Fallback สำหรับโหมด Dev (ถ้าไม่มี transaction ให้โชว์ QR จำลอง)
      setQrCodeUrl("https://example.com/mock-qr-code");
      setUploadStatus("done");
      return;
    }

    hasCreatedPresign.current = true;

    const createPresignSession = async () => {
      try {
        const transactionCode = state.referenceId
          ? state.referenceId.startsWith("TXN-")
            ? state.referenceId
            : `TXN-${state.referenceId}`
          : undefined;

        const filesMeta: { type: string; contentType: string }[] = [];
        filesMeta.push({ type: "photo", contentType: "image/jpeg" }); // finalImage
        frameCaptures.forEach((cap: Capture) => {
          if (cap.photo)
            filesMeta.push({ type: "photo", contentType: "image/jpeg" });
        });
        if (frameCaptures.some((cap: Capture) => cap.videoPath)) {
          filesMeta.push({ type: "video", contentType: "video/mp4" });
        }

        const presignResult: any = await invoke("create_presign_upload", {
          transactionId,
          files: filesMeta,
          transactionCode: transactionCode || null,
        });

        const responseData = presignResult.data || presignResult;

        if (presignResult.success && responseData.qrcodeStorageUrl) {
          setQrCodeUrl(responseData.qrcodeStorageUrl);
          setSessionId(responseData.photoSession?.id || "");
          setUploadUrls(responseData.uploadUrls || []);
        } else {
          hasCreatedPresign.current = false;
        }
      } catch (err) {
        hasCreatedPresign.current = false;
      }
    };
    createPresignSession();
  }, [state?.transactionId, state?.referenceId]);

  // ====================================================================
  // Logic 3: Upload files (รันเบื้องหลัง)
  // ====================================================================
  const uploadFiles = useCallback(
    async (composedImg: string) => {
      if (hasUploadedFiles.current || !sessionId || uploadUrls.length === 0)
        return;
      hasUploadedFiles.current = true;

      try {
        setUploadStatus("uploading");
        setStatusText("กำลังอัปโหลดไฟล์...");

        const photoUrls = uploadUrls
          .filter((u: any) => u.type === "photo")
          .sort((a: any, b: any) => a.order - b.order);
        const videoUrls = uploadUrls
          .filter((u: any) => u.type === "video")
          .sort((a: any, b: any) => a.order - b.order);
        const uploadedFiles: { key: string; type: string; order: number }[] =
          [];
        let photoIdx = 0;

        if (photoIdx < photoUrls.length) {
          const composedPath: string = await invoke("save_temp_image", {
            imageDataBase64: composedImg,
            filename: "frame-photo.jpg",
          });
          try {
            await invoke("upload_to_presigned_url", {
              url: photoUrls[photoIdx].uploadUrl,
              filePath: composedPath,
              contentType: "image/jpeg",
            });
            uploadedFiles.push({
              key: photoUrls[photoIdx].key,
              type: "photo",
              order: photoUrls[photoIdx].order,
            });
          } catch (err) {}
          photoIdx++;
        }

        for (
          let i = 0;
          i < frameCaptures.length && photoIdx < photoUrls.length;
          i++
        ) {
          const photoPath: string = await invoke("save_temp_image", {
            imageDataBase64: frameCaptures[i].photo,
            filename: `photo-${i + 1}.jpg`,
          });
          try {
            await invoke("upload_to_presigned_url", {
              url: photoUrls[photoIdx].uploadUrl,
              filePath: photoPath,
              contentType: "image/jpeg",
            });
            uploadedFiles.push({
              key: photoUrls[photoIdx].key,
              type: "photo",
              order: photoUrls[photoIdx].order,
            });
          } catch (err) {}
          photoIdx++;
        }

        if (videoUrls.length > 0) {
          const videoPaths = frameCaptures
            .map((cap: Capture) => cap.videoPath)
            .filter((p): p is string => !!p);
          if (videoPaths.length > 0) {
            try {
              let lutPath: string | null = null;
              if (
                selectedFilter &&
                selectedFilter.type === "lut" &&
                selectedFilter.lutFile
              ) {
                try {
                  lutPath = await invoke<string>("resolve_lut_path", {
                    lutFile: selectedFilter.lutFile,
                  });
                } catch (err) {}
              }
              const composedVideoPath: string = await invoke(
                "compose_frame_video",
                {
                  frameImageUrl: selectedFrame?.imageUrl || "",
                  videoPaths,
                  slots,
                  frameWidth,
                  frameHeight,
                  outputFilename: "framed-video.mp4",
                  lutPath,
                },
              );
              await invoke("upload_to_presigned_url", {
                url: videoUrls[0].uploadUrl,
                filePath: composedVideoPath,
                contentType: "video/mp4",
              });
              uploadedFiles.push({
                key: videoUrls[0].key,
                type: "video",
                order: videoUrls[0].order,
              });
            } catch (err) {}
          }
        }

        if (uploadedFiles.length > 0) {
          try {
            await invoke("confirm_upload", { sessionId, uploadedFiles });
          } catch (err) {}
        }
        setUploadStatus("done");
        setStatusText("อัปโหลดเสร็จสิ้น!");
      } catch (err) {
        setUploadStatus("error");
        hasUploadedFiles.current = false;
      }
    },
    [sessionId, uploadUrls, frameCaptures],
  );

  // ====================================================================
  // Logic 4: Print frame (รันเบื้องหลัง)
  // ====================================================================
  const printFrame = useCallback(
    async (composedImg: string) => {
      try {
        setPrintStatus("printing");

        // Determine frame type for cutting
        // Rust print_photo handles duplication automatically for 2x6 and 6x2
        let frameType = "4x6";
        let isLandscape = false;
        if (frameWidth && frameHeight) {
          const ratio = frameWidth / frameHeight;
          if (ratio < 0.5) {
            frameType = "2x6";      // portrait-cut: 2x6 → duplicated to 4x6 by Rust
          } else if (ratio > 2) {
            frameType = "6x2";      // landscape-cut: 6x2 → duplicated to 6x4 by Rust
            isLandscape = true;
          } else if (ratio > 1) {
            frameType = "6x4";      // landscape no-cut
            isLandscape = true;
          }
          // else: 4x6 portrait no-cut (default)
        }

        // Save to temp file (Rust handles 2x6/6x2 duplication internally)
        const printPath: string = await invoke("save_temp_image", {
          imageDataBase64: composedImg,
          filename: "print-frame.png",
        });

        // Load paper position config (per-orientation: paperConfigPortrait / paperConfigLandscape)
        let scale = 100;
        let verticalOffset = 0;
        let horizontalOffset = 0;
        try {
          const key = isLandscape
            ? "paperConfigLandscape"
            : "paperConfigPortrait";
          const saved = localStorage.getItem(key);
          if (saved) {
            const config = JSON.parse(saved);
            scale = config.scale ?? 100;
            verticalOffset = config.vertical ?? 0;
            horizontalOffset = config.horizontal ?? 0;
          }
        } catch {}

        let printerName = localStorage.getItem("selectedPrinter") || "";
        if (!printerName) {
          const printers: any[] = await invoke("get_printers");
          const dnpPrinter = printers.find(
            (p: any) =>
              p.name.toLowerCase().includes("qw-410") ||
              p.name.toLowerCase().includes("dnp") ||
              p.is_online,
          );
          if (dnpPrinter) printerName = dnpPrinter.name;
        }

        if (printerName) {
          // Set printing state BEFORE checking printer status to prevent false notifications
          // This must be done synchronously before any async operations
          setPrinting(true, 45000); // 45 second timeout (longer than print operation)
          console.log("[PhotoResult] Printing state set to true before print");

          // Small delay to ensure printing state is set before device check runs
          await new Promise((resolve) => setTimeout(resolve, 100));

          try {
            await invoke("print_photo", {
              imagePath: printPath,
              printerName,
              frameType,
              scale,
              verticalOffset,
              horizontalOffset,
              isLandscape,
            });

            // Reduce paper level
            await invoke("reduce_paper_level", { copies: 1 });
            setPrintStatus("done");
          } finally {
            // Clear printing state after print completes (includes grace period)
            console.log(
              "[PhotoResult] Print completed, clearing printing state",
            );
            setPrinting(false);
          }
        } else {
          setPrintStatus("no-printer");
        }
      } catch (err) {
        setPrintStatus("error");
        // Clear printing state on error
        setPrinting(false);
      }
    },
    [frameWidth, frameHeight],
  );

  // Trigger: Compose -> Print
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    const process = async () => {
      const composedImg = await composeFrame();
      if (!composedImg) return;
      printFrame(composedImg);
    };
    process();
  }, []);

  // Trigger: Upload
  useEffect(() => {
    if (!composedImage || !sessionId || uploadUrls.length === 0) return;
    if (hasUploadedFiles.current) return;
    uploadFiles(composedImage);
  }, [composedImage, sessionId, uploadUrls, uploadFiles]);

  const handleHome = () => {
    navigate("/");
  };

  // ====================================================================
  // UI แสดงผลรูปภาพแบบ "ทันที (Instant CSS Compose)"
  // ====================================================================

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: 0,
        position: "relative",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* 1. Header */}
      <div
        style={{
          position: "relative",
          width: "100%",
          padding: "50px 40px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          zIndex: 100,
        }}
      >
        {/* โลโก้ซ้ายบน */}
        <div
          style={{
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <span
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              color: "#f13b4f",
              lineHeight: 0.9,
            }}
          >
            timelab
          </span>
          <span
            style={{
              fontSize: "10px",
              color: "#f13b4f",
              letterSpacing: "1px",
              fontWeight: "bold",
            }}
          >
            PHOTO BOOTH
          </span>
        </div>

        {/* หัวข้อตรงกลาง */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            top: "80px",
            width: "100%",
            zIndex: 5,
          }}
        >
          <div className="page-title-section">
            <h1 className="title-thai" style={{ color: theme.fontColor }}>
              รูปภาพของคุณ
            </h1>
            <p className="title-english" style={{ color: theme.fontColor }}>
              YOUR PHOTO IS READY
            </p>
          </div>
        </div>

        {/* ตัวนับเวลาขวาบน */}
        <div style={{ zIndex: 10 }}>
          <Countdown
            seconds={COUNTDOWN.PHOTO_RESULT.DURATION}
            visible={COUNTDOWN.PHOTO_RESULT.VISIBLE}
            onComplete={() => navigate("/")}
          />
        </div>
      </div>

      {/* 2. เนื้อหาตรงกลาง */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: "120px",
          paddingBottom: "20px",
          width: "100%",
        }}
      >
        {/* 🔥 โชว์รูปทันทีด้วยเทคนิค CSS Layering ซ้อนกัน 🔥 */}
        <div
          style={{
            width: "auto",
            maxWidth: "85%",
            height: "auto",
            maxHeight: "45vh",
            aspectRatio: frameAspectRatioCSS,
            borderRadius: "10px",
            overflow: "hidden",
            boxShadow: "0 15px 35px rgba(0,0,0,0.25)",
            position: "relative",
            backgroundColor: "white",
          }}
        >
          {selectedFrame && frameCaptures.length > 0 ? (
            <div
              style={{ position: "relative", width: "100%", height: "100%" }}
            >
              {/* เลเยอร์ 1: รูปลูกค้าที่ถูกใส่ฟิลเตอร์มาแล้ว (อยู่ชั้นล่าง) */}
              {slots.map((slot: any, index: number) => {
                const capture = frameCaptures[index] || frameCaptures[0];
                if (!capture) return null;

                // คำนวณตำแหน่ง % ให้ตรงกับเฟรม
                const left = (slot.x / frameWidth) * 100;
                const top = (slot.y / frameHeight) * 100;
                const width = (slot.width / frameWidth) * 100;
                const height = (slot.height / frameHeight) * 100;

                return (
                  <div
                    key={index}
                    style={{
                      position: "absolute",
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${width}%`,
                      height: `${height}%`,
                      zIndex: 5,
                      overflow: "hidden",
                    }}
                  >
                    <img
                      src={capture.photo}
                      draggable={false}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  </div>
                );
              })}

              {/* เลเยอร์ 2: กรอบเฟรม PNG เจาะทะลุ (อยู่ชั้นบนสุด) */}
              <img
                src={selectedFrame.imageUrl}
                draggable={false}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "fill",
                  zIndex: 10,
                  pointerEvents: "none",
                }}
              />
            </div>
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#aaa",
              }}
            >
              ไม่พบข้อมูลรูปภาพ
            </div>
          )}
        </div>

        {/* 3. ส่วนของ QR Code */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            marginTop: "40px",
            flexShrink: 0,
          }}
        >
          <h3
            style={{
              color: theme.fontColor,
              fontSize: "16px",
              fontWeight: "bold",
              margin: "0 0 10px 0",
            }}
          >
            Download Digital File
          </h3>

          <div
            style={{
              width: "140px",
              height: "140px",
              backgroundColor: "white",
              borderRadius: "15px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 5px 15px rgba(0,0,0,0.1)",
              overflow: "hidden",
              padding: "10px",
              marginBottom: "5px",
            }}
          >
            {qrCodeUrl ? (
              <QRCodeSVG value={qrCodeUrl} size={120} level="M" />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  border: "2px dashed #ddd",
                  borderRadius: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#bbb",
                  flexDirection: "column",
                  gap: "5px",
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    border: "2px solid #eee",
                    borderTop: "2px solid #e94560",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <span style={{ fontSize: "11px", marginTop: "5px" }}>
                  Generating...
                </span>
              </div>
            )}
          </div>

          {/* สถานะ Upload & Print (อิงตาม Logic หลังบ้าน) */}
          <div
            style={{
              display: "flex",
              gap: "15px",
              fontSize: "12px",
              color: "#888",
              marginTop: "5px",
              fontWeight: "500",
            }}
          >
            <span>
              📤{" "}
              {uploadStatus === "done"
                ? "Uploaded"
                : uploadStatus === "uploading"
                  ? "Uploading..."
                  : uploadStatus === "error"
                    ? "❌ Error"
                    : "Processing"}
            </span>
            <span>
              🖨️{" "}
              {printStatus === "done"
                ? "Printed"
                : printStatus === "printing"
                  ? "Printing..."
                  : printStatus === "no-printer"
                    ? "⚠️ No printer"
                    : printStatus === "error"
                      ? "❌ Error"
                      : "Waiting"}
            </span>
          </div>
        </div>
      </div>

      {/* 4. ปุ่มล่างสุด "ปิดหน้าต่าง / CLOSE" */}
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          paddingBottom: "50px",
          paddingTop: "10px",
          zIndex: 100,
        }}
      >
        <button
          onClick={handleHome}
          // ล็อกปุ่มไว้ถ้ายังอัปโหลดไม่เสร็จ (ยกเว้นมี Error ก็ให้ปิดได้เลย)
          disabled={uploadStatus !== "done" && uploadStatus !== "error"}
          style={{
            backgroundColor:
              uploadStatus === "done" || uploadStatus === "error"
                ? theme.primaryColor
                : "#666",
            color:
              uploadStatus === "done" || uploadStatus === "error"
                ? theme.textButtonColor
                : "white",
            padding: "14px 70px",
            borderRadius: "14px",
            fontSize: "22px",
            fontWeight: "600",
            border: "none",
            cursor:
              uploadStatus === "done" || uploadStatus === "error"
                ? "pointer"
                : "not-allowed",
            boxShadow:
              uploadStatus === "done" || uploadStatus === "error"
                ? "0 8px 25px rgba(0,0,0,0.25)"
                : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s",
            outline: "none",
            minWidth: "220px",
            letterSpacing: "1px",
          }}
        >
          {/* เปลี่ยนคำตามสถานะ */}
          {uploadStatus !== "done" && uploadStatus !== "error"
            ? statusText
            : "ปิดหน้าต่าง / CLOSE"}
        </button>
      </div>

      <style>
        {`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}
      </style>
    </div>
  );
}
