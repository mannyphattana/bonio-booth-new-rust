import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import { setPrinting } from "../utils/printingState";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function PhotoResult({ theme, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};

  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const frameCaptures: Capture[] = state.frameCaptures || [];
  const selectedFrame = state.selectedFrame;
  const selectedFilter = state.selectedFilter;
  const quantity: number = state.quantity || 1;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];
  
  const [_imgW, _imgH] = (selectedFrame?.imageSize || "")
    .split("x")
    .map(Number);
  const frameWidth = (_imgW > 0 ? _imgW : selectedFrame?.grid?.width) || 1200;
  const frameHeight = (_imgH > 0 ? _imgH : selectedFrame?.grid?.height) || 1800;

  const [composedImage, setComposedImage] = useState<string>("");
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [uploadUrls, setUploadUrls] = useState<any[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string>("processing");
  const [printStatus, setPrintStatus] = useState<string>("idle");
  const [error, setError] = useState("");
  const [, setStatusText] = useState("กำลังประมวลผล...");

  const hasStarted = useRef(false);
  const hasCreatedPresign = useRef(false);
  const hasUploadedFiles = useRef(false);
  useIdleTimeout();

  // Compose frame image
  const composeFrame = useCallback(async () => {
    try {
      setStatusText("กำลังรวมรูปภาพ...");
      console.log("📸 [PhotoResult] Frame dimensions:", {
        imageSize: selectedFrame?.imageSize,
        gridWidth: selectedFrame?.grid?.width,
        gridHeight: selectedFrame?.grid?.height,
        usedWidth: frameWidth,
        usedHeight: frameHeight,
        slotsCount: slots.length,
        firstSlot: slots[0],
      });
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

  useEffect(() => {
    if (hasCreatedPresign.current) return;

    const transactionId =
      state.transactionId || state.referenceId || state.transaction_id || "";

    console.log("📸 [PhotoResult] State keys:", Object.keys(state));
    console.log("📸 [PhotoResult] transactionId:", transactionId);
    console.log("📸 [PhotoResult] state.transactionId:", state.transactionId);
    console.log("📸 [PhotoResult] state.referenceId:", state.referenceId);

    if (!transactionId) {
      console.error(
        "❌ [PhotoResult] No transactionId found in state! Cannot create presign session.",
      );
      return;
    }

    hasCreatedPresign.current = true;

    const createPresignSession = async () => {
      try {
        console.log("📸 [PhotoResult] Creating presigned upload session...");

        const transactionCode = state.referenceId
          ? state.referenceId.startsWith("TXN-")
            ? state.referenceId
            : `TXN-${state.referenceId}`
          : undefined;

        const filesMeta: { type: string; contentType: string }[] = [];

        filesMeta.push({ type: "photo", contentType: "image/jpeg" });

        frameCaptures.forEach((cap: Capture) => {
          if (cap.photo) {
            filesMeta.push({ type: "photo", contentType: "image/jpeg" });
          }
        });

        if (frameCaptures.some((cap: Capture) => cap.videoPath)) {
          filesMeta.push({ type: "video", contentType: "video/mp4" });
        }

        console.log("📸 [PhotoResult] Files metadata for presign:", {
          totalFiles: filesMeta.length,
          photos: filesMeta.filter((f) => f.type === "photo").length,
          videos: filesMeta.filter((f) => f.type === "video").length,
        });

        const presignResult: any = await invoke("create_presign_upload", {
          transactionId,
          files: filesMeta,
          transactionCode: transactionCode || null,
        });

        const responseData = presignResult.data || presignResult;

        if (presignResult.success && responseData.qrcodeStorageUrl) {
          console.log(
            "✅ [PhotoResult] Presign session created! QR Code URL:",
            responseData.qrcodeStorageUrl,
          );
          setQrCodeUrl(responseData.qrcodeStorageUrl);
          setSessionId(responseData.photoSession?.id || "");
          setUploadUrls(responseData.uploadUrls || []);
          console.log(
            "✅ [PhotoResult] Session ID:",
            responseData.photoSession?.id,
          );
          console.log(
            "✅ [PhotoResult] Upload URLs count:",
            responseData.uploadUrls?.length || 0,
          );
        } else {
          console.error(
            "❌ [PhotoResult] Failed to create presign session:",
            responseData.error || responseData.message || presignResult.error,
          );
          hasCreatedPresign.current = false; 
        }
      } catch (err) {
        console.error("❌ [PhotoResult] Error creating presign session:", err);
        hasCreatedPresign.current = false; 
      }
    };

    createPresignSession();
  }, [state?.transactionId, state?.referenceId]); 

  const uploadFiles = useCallback(
    async (composedImg: string) => {
      if (hasUploadedFiles.current) return;
      if (!sessionId || uploadUrls.length === 0) {
        console.warn(
          "⚠️ [PhotoResult] No sessionId/uploadUrls yet, waiting...",
        );
        return;
      }
      hasUploadedFiles.current = true;

      try {
        setUploadStatus("uploading");
        setStatusText("กำลังอัปโหลด...");

        const photoUrls = uploadUrls
          .filter((u: any) => u.type === "photo")
          .sort((a: any, b: any) => a.order - b.order);
        const videoUrls = uploadUrls
          .filter((u: any) => u.type === "video")
          .sort((a: any, b: any) => a.order - b.order);

        console.log(
          `📤 [PhotoResult] Upload targets: ${photoUrls.length} photo URLs, ${videoUrls.length} video URLs`,
        );

        const uploadedFiles: { key: string; type: string; order: number }[] =
          [];
        let photoIdx = 0;

        if (photoIdx < photoUrls.length) {
          setStatusText("กำลังอัปโหลดรูปเฟรม...");
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
            console.log(
              `✅ [PhotoResult] Frame photo uploaded (order ${photoUrls[photoIdx].order})`,
            );
          } catch (err) {
            console.error("❌ [PhotoResult] Frame photo upload failed:", err);
          }
          photoIdx++;
        }

        for (
          let i = 0;
          i < frameCaptures.length && photoIdx < photoUrls.length;
          i++
        ) {
          setStatusText(`กำลังอัปโหลดรูป ${i + 1}/${frameCaptures.length}...`);
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
            console.log(
              `✅ [PhotoResult] Photo ${i + 1} uploaded (order ${photoUrls[photoIdx].order})`,
            );
          } catch (err) {
            console.error(
              `❌ [PhotoResult] Photo ${i + 1} upload failed:`,
              err,
            );
          }
          photoIdx++;
        }

        if (videoUrls.length > 0) {
          const videoPaths = frameCaptures
            .map((cap: Capture) => cap.videoPath)
            .filter((p): p is string => !!p);

          if (videoPaths.length > 0) {
            setStatusText("กำลังรวมวิดีโอ...");
            try {
              console.log(
                `🎬 [PhotoResult] Composing framed video with ${videoPaths.length} captures...`,
              );
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
                } catch (err) {
                  console.warn(
                    "⚠️ [PhotoResult] Could not resolve LUT path for video:",
                    err,
                  );
                }
              }

              const composedVideoPath: string = await invoke(
                "compose_frame_video",
                {
                  frameImageUrl: selectedFrame?.imageUrl || "",
                  videoPaths,
                  slots: slots,
                  frameWidth: frameWidth,
                  frameHeight: frameHeight,
                  outputFilename: "framed-video.mp4",
                  lutPath: lutPath,
                },
              );
              console.log(
                `✅ [PhotoResult] Framed video composed: ${composedVideoPath}`,
              );

              // 🚨 [เพิ่มใหม่] สั่งเซฟไฟล์วิดีโอ (mp4) ลงเครื่องคอมพิวเตอร์
              try {
                const txId = state.transactionId || state.referenceId || new Date().getTime();
                await invoke("copy_video_to_local_drive", {
                  sourcePath: composedVideoPath,
                  filename: `BonioBooth_${txId}.mp4`, 
                });
                console.log("✅ [PhotoResult] Saved video to local drive successfully!");
              } catch (err) {
                console.error("❌ [PhotoResult] Save video to local drive failed:", err);
              }

              setStatusText("กำลังอัปโหลดวิดีโอ...");
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
              console.log(
                `✅ [PhotoResult] Framed video uploaded (order ${videoUrls[0].order})`,
              );
            } catch (err) {
              console.error(
                "❌ [PhotoResult] Video compose/upload failed:",
                err,
              );
            }
          }
        }

        if (uploadedFiles.length > 0) {
          console.log(
            `📤 [PhotoResult] Confirming ${uploadedFiles.length} uploaded files...`,
          );
          try {
            await invoke("confirm_upload", {
              sessionId,
              uploadedFiles,
            });
            console.log("✅ [PhotoResult] Upload confirmed!");
          } catch (err) {
            console.error("❌ [PhotoResult] Confirm upload failed:", err);
          }
        }

        setUploadStatus("done");
        setStatusText("อัปโหลดเสร็จสิ้น!");
      } catch (err) {
        console.error("❌ [PhotoResult] Upload error:", err);
        setUploadStatus("error");
        hasUploadedFiles.current = false; 
      }
    },
    [sessionId, uploadUrls, frameCaptures, selectedFrame, selectedFilter, slots, frameWidth, frameHeight, state.transactionId, state.referenceId],
  );

  const printFrame = useCallback(
    async (composedImg: string, printQuantity: number = 1) => {
      try {
        setPrintStatus("printing");

        let frameType = "4x6";
        let isLandscape = false;
        if (frameWidth && frameHeight) {
          const ratio = frameWidth / frameHeight;
          if (ratio < 0.5) {
            frameType = "2x6";      
          } else if (ratio > 2) {
            frameType = "6x2";      
            isLandscape = true;
          } else if (ratio > 1) {
            frameType = "6x4";      
            isLandscape = true;
          }
        }

        const printPath: string = await invoke("save_temp_image", {
          imageDataBase64: composedImg,
          filename: "print-frame.png",
        });

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
        } catch {
        }

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
          const printTimeout = printQuantity * 45000; 
          setPrinting(true, printTimeout);
          console.log(`[PhotoResult] Printing state set to true before print (${printQuantity} copies, timeout: ${printTimeout}ms)`);
          
          await new Promise(resolve => setTimeout(resolve, 100));

          try {
            for (let i = 0; i < printQuantity; i++) {
              console.log(`[PhotoResult] Printing copy ${i + 1}/${printQuantity}...`);
              await invoke("print_photo", {
                imagePath: printPath,
                printerName,
                frameType,
                scale,
                verticalOffset,
                horizontalOffset,
                isLandscape,
              });
            }

            await invoke("reduce_paper_level", { copies: printQuantity });
            setPrintStatus("done");
          } finally {
            console.log("[PhotoResult] Print completed, clearing printing state");
            setPrinting(false);
          }
        } else {
          setPrintStatus("no-printer");
          console.warn("No printer found");
        }
      } catch (err) {
        console.error("Print error:", err);
        setPrintStatus("error");
        setPrinting(false);
      }
    },
    [frameWidth, frameHeight],
  );

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const process = async () => {
      const composedImg = await composeFrame();
      if (!composedImg) return;

      // 🚨 [เพิ่มใหม่] สั่งเซฟรูปภาพ (jpg) ลงเครื่องคอมพิวเตอร์
      try {
        const txId = state.transactionId || state.referenceId || new Date().getTime();
        await invoke("save_to_local_drive", {
          imageDataBase64: composedImg,
          filename: `BonioBooth_${txId}.jpg`, // เซฟเป็น .jpg
        });
        console.log("✅ [PhotoResult] Saved photo to local drive successfully!");
      } catch (err) {
        console.error("❌ [PhotoResult] Save photo to local drive failed:", err);
      }

      // สั่งปริ้นท์ทันที
      printFrame(composedImg, quantity);
    };

    process();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!composedImage || !sessionId || uploadUrls.length === 0) return;
    if (hasUploadedFiles.current) return;

    uploadFiles(composedImage);
  }, [composedImage, sessionId, uploadUrls, uploadFiles]);

  useEffect(() => {
    const checkPrinter = setInterval(async () => {
      try {
        const printers: any[] = await invoke("get_printers");
        const hasPrinter = printers.some((p: any) => p.is_online);
        if (!hasPrinter && printStatus === "printing") {
          setError("เครื่องปริ้นถูกถอดออก กรุณาเชื่อมต่อใหม่");
          setTimeout(() => navigate("/"), 3000);
        }
      } catch {
      }
    }, 5000);

    return () => clearInterval(checkPrinter);
  }, [printStatus, navigate]);

  const handleHome = () => {
    navigate("/");
  };

  const isUploading = uploadStatus === "processing" || uploadStatus === "uploading";

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "120px 0",
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <Countdown
        seconds={COUNTDOWN.PHOTO_RESULT.DURATION}
        onComplete={handleHome}
        visible={COUNTDOWN.PHOTO_RESULT.VISIBLE}
      />

      <h1
        style={{
          color: theme.fontColor,
          fontSize: 22,
          marginTop: 20,
          marginBottom: 4,
        }}
      >
        ภาพถ่ายของคุณ
      </h1>
      <p
        style={{
          color: theme.fontColor,
          opacity: 0.8,
          fontSize: 14,
          marginBottom: 12,
        }}
      >
        YOUR PHOTO
      </p>

      {/* Composed frame preview */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "8px 24px",
          width: "100%",
          minHeight: 0,
        }}
      >
        {composedImage ? (
          <div
            style={{
              maxWidth: "80%",
              maxHeight: "45vh",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              aspectRatio: `${frameWidth} / ${frameHeight}`,
            }}
          >
            <img
              src={composedImage}
              alt="Final Photo"
              style={{
                maxWidth: "100%",
                maxHeight: "45vh",
                objectFit: "contain",
                borderRadius: 12,
              }}
            />
          </div>
        ) : (
          <div
            style={{
              color: "#aaa",
              fontSize: 16,
              textAlign: "center",
            }}
          >
            กำลังประมวลผลรูปภาพ...
          </div>
        )}
      </div>

      {/* QR Code for download */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "0 16px",
          marginBottom: 8,
        }}
      >
        <p style={{ color: theme.fontColor, fontSize: 14 }}>
          สแกนเพื่อดาวน์โหลดรูปภาพ
        </p>

        <div
          style={{
            background: "#fff",
            padding: 12,
            borderRadius: 12,
            width: 160,
            height: 160,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {qrCodeUrl ? (
            <QRCodeSVG value={qrCodeUrl} size={136} />
          ) : (
            <div style={{ color: "#999", fontSize: 12, textAlign: "center" }}>
              {uploadStatus === "uploading"
                ? "Uploading..."
                : uploadStatus === "error"
                  ? "Upload failed"
                  : "Generating..."}
            </div>
          )}
        </div>
      </div>

      {/* Status indicators */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 8,
          fontSize: 13,
        }}
      >
        <span>
          📤{" "}
          {uploadStatus === "done"
            ? "✅ Uploaded"
            : uploadStatus === "uploading"
              ? "⏳ Uploading..."
              : uploadStatus === "error"
                ? "❌ Error"
                : "⏳ Processing"}
        </span>
        <span>
          🖨️{" "}
          {printStatus === "done"
            ? "✅ Printed"
            : printStatus === "printing"
              ? "⏳ Printing..."
              : printStatus === "no-printer"
                ? "⚠️ No printer"
                : printStatus === "error"
                  ? "❌ Error"
                  : "⏳ Waiting"}
        </span>
      </div>

      {/* Error display */}
      {error && (
        <p
          style={{
            color: "#e94560",
            fontSize: 14,
            marginBottom: 8,
            textAlign: "center",
            padding: "0 16px",
          }}
        >
          {error}
        </p>
      )}

      {/* ปุ่ม Home พร้อมแสดงสถานะระหว่างอัปโหลด */}
      <button
        className="primary-button"
        onClick={handleHome}
        disabled={isUploading}
        style={{
          background: isUploading ? "#888888" : theme.primaryColor,
          color: theme.textButtonColor,
          marginBottom: 20,
          cursor: isUploading ? "not-allowed" : "pointer",
          opacity: isUploading ? 0.7 : 1,
          transition: "all 0.3s ease" 
        }}
      >
        {isUploading ? "⏳ กำลังอัปโหลดภาพและวิดีโอ..." : "กลับหน้าหลัก / HOME"}
      </button>
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}