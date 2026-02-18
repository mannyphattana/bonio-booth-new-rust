import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
}

export default function PhotoResult({ theme }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};

  const frameCaptures: Capture[] = state.frameCaptures || [];
  const selectedFrame = state.selectedFrame;
  const selectedFilter = state.selectedFilter;
  const slots: FrameSlot[] = selectedFrame?.grid?.slots || [];
  // Slot coordinates are in imageSize space (matching old project)
  // imageSize = frame pixel dimensions (e.g. "2400x3600")
  // grid.width/height = logical frame format (e.g. 1200x1800 = 2x3)
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
  // const [countdown, setCountdown] = useState(300); // Removed custom state
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

  // Step 1: Create presigned upload session immediately
  // This returns qrcodeStorageUrl + presigned URLs + sessionId
  // QR code is displayed BEFORE any files are uploaded (matches reference flow)
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

        // Format transaction code (optional)
        const transactionCode = state.referenceId
          ? state.referenceId.startsWith("TXN-")
            ? state.referenceId
            : `TXN-${state.referenceId}`
          : undefined;

        // Build files metadata for presign request
        const filesMeta: { type: string; contentType: string }[] = [];

        // finalImage (composed frame photo) - always present
        filesMeta.push({ type: "photo", contentType: "image/jpeg" });

        // Individual capture photos
        frameCaptures.forEach((cap: Capture) => {
          if (cap.photo) {
            filesMeta.push({ type: "photo", contentType: "image/jpeg" });
          }
        });

        // ONE compiled frame video (if any captures have video)
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

        // The API response is wrapped in ApiResponse { success, data, error }
        const responseData = presignResult.data || presignResult;

        if (presignResult.success && responseData.qrcodeStorageUrl) {
          console.log(
            "✅ [PhotoResult] Presign session created! QR Code URL:",
            responseData.qrcodeStorageUrl,
          );
          // Set QR code URL immediately - shows QR before upload starts
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
          hasCreatedPresign.current = false; // Allow retry
        }
      } catch (err) {
        console.error("❌ [PhotoResult] Error creating presign session:", err);
        hasCreatedPresign.current = false; // Allow retry
      }
    };

    createPresignSession();
  }, [state?.transactionId, state?.referenceId]); // eslint-disable-line

  // Step 2: Upload files to presigned URLs (runs after presign + compose are done)
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

        // Separate photo and video upload URLs (sorted by order)
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

        // Upload composed frame (order 1 = finalImage)
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

        // Upload individual capture photos
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

        // Upload compiled frame video (ONE video with all captures in frame layout)
        if (videoUrls.length > 0) {
          // Collect all video paths from captures
          const videoPaths = frameCaptures
            .map((cap: Capture) => cap.videoPath)
            .filter((p): p is string => !!p);

          if (videoPaths.length > 0) {
            setStatusText("กำลังรวมวิดีโอ...");
            try {
              // Compose all capture videos into one framed video
              console.log(
                `🎬 [PhotoResult] Composing framed video with ${videoPaths.length} captures...`,
              );
              // Resolve LUT path for video filter if a filter is selected
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

        // Confirm upload
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
        hasUploadedFiles.current = false; // Allow retry
      }
    },
    [sessionId, uploadUrls, frameCaptures],
  );

  // Print the composed frame
  const printFrame = useCallback(
    async (composedImg: string) => {
      try {
        setPrintStatus("printing");

        // Save to temp file
        const printPath: string = await invoke("save_temp_image", {
          imageDataBase64: composedImg,
          filename: "print-frame.png",
        });

        // Determine frame type for cutting
        let frameType = "4x6";
        let isLandscape = false;
        if (frameWidth && frameHeight) {
          const ratio = frameWidth / frameHeight;
          if (ratio < 0.5) {
            frameType = "2x6";
          } else if (ratio > 1) {
            frameType = "6x4";
            isLandscape = true;
          }
        }

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
        } catch {
          /* use defaults */
        }

        // Get selected printer (from config or auto-detect)
        let printerName = localStorage.getItem("selectedPrinter") || "";

        if (!printerName) {
          // Fallback: auto-detect printer
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
        } else {
          setPrintStatus("no-printer");
          console.warn("No printer found");
        }
      } catch (err) {
        console.error("Print error:", err);
        setPrintStatus("error");
      }
    },
    [frameWidth, frameHeight],
  );

  // Main effect - compose frame + print immediately
  // Upload is triggered separately when presign data + composed image are both ready
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const process = async () => {
      // Compose frame
      const composedImg = await composeFrame();
      if (!composedImg) return;

      // Print immediately (doesn't need presign)
      printFrame(composedImg);
    };

    process();
  }, []); // eslint-disable-line

  // Trigger upload when presign data arrives AND composedImage is ready
  useEffect(() => {
    if (!composedImage || !sessionId || uploadUrls.length === 0) return;
    if (hasUploadedFiles.current) return;

    uploadFiles(composedImage);
  }, [composedImage, sessionId, uploadUrls, uploadFiles]);

  // Auto-return countdown handled by Countdown component
  /*
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate]);
  */

  // Printer disconnect check
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
        // Ignore
      }
    }, 5000);

    return () => clearInterval(checkPrinter);
  }, [printStatus, navigate]);

  const handleHome = () => {
    navigate("/");
  };

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "120px 0",
      }}
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

      {/* Home button */}
      <button
        className="primary-button"
        onClick={handleHome}
        style={{
          background: theme.primaryColor,
          color: theme.textButtonColor,
          marginBottom: 20,
        }}
      >
        กลับหน้าหลัก / HOME
      </button>
    </div>
  );
}
