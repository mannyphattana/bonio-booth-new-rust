import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import { useIdleTimeout } from "../hooks/useIdleTimeout";
import Countdown from "../components/Countdown";
import PrintAgainModal from "../components/PrintAgainModal";
import { COUNTDOWN, BORDERLESS_PRINT } from "../config/appConfig";
import { setPrinting } from "../utils/printingState";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";
import {
  getPaperTypeByOrientation,
  getPaperConfig,
  getPaperSize,
  getSelectedPrinter,
} from "../config/printProfile";

interface Props {
  theme: ThemeData;
  machineData: MachineData;
  onFormatReset: () => void;
  onBeforeClose?: () => void;
}

export default function PhotoResult({ theme, machineData, onFormatReset, onBeforeClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as any) || {};

  const { showContextMenu, setShowContextMenu, handleContextMenu, handleTouchStart } = useContextMenu();

  const frameCaptures: Capture[] = state.frameCaptures || [];
  const allCaptures: Capture[] = state.captures || [];
  const selectedCaptureIndexes: number[] = state.selectedCaptureIndexes || [];
  const captureVideoDiagnostics: Array<{
    captureIndex: number;
    status: "ok" | "missing";
    reason: string;
    blobSize: number;
    cameraType: string;
  }> = state.captureVideoDiagnostics || [];
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
  const [finalVideoPath, setFinalVideoPath] = useState<string>("");
  const [mediaReady, setMediaReady] = useState<boolean>(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [sessionId, setSessionId] = useState<string>("");
  const [uploadUrls, setUploadUrls] = useState<any[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string>("processing");
  const [printStatus, setPrintStatus] = useState<string>("idle");
  const [error, setError] = useState("");
  const [, setStatusText] = useState("กำลังประมวลผล...");

  // ปุ่ม "Print again" — modal เลือกจำนวน/จ่ายเงินแล้วพิมพ์รูปเดิมซ้ำ
  const [showReprintModal, setShowReprintModal] = useState(false);
  // เพิ่มค่าเพื่อ remount Countdown ให้เริ่มนับใหม่สดๆ หลังปิด modal
  const [countdownKey, setCountdownKey] = useState(0);
  const originalTransactionId: string =
    state.transactionId || state.referenceId || state.transaction_id || "";

  const hasStarted = useRef(false);
  const hasCreatedPresign = useRef(false);
  const hasUploadedFiles = useRef(false);
  const hasLoggedMissingVideoRef = useRef(false);
  // ระหว่างเปิด modal พิมพ์ซ้ำ (รอลูกค้าสแกนจ่าย) ต้องไม่เด้งกลับหน้าหลักเอง
  useIdleTimeout("/", !showReprintModal);

  const buildVideoPathsBySlot = useCallback((): string[] => {
    const slotVideoPaths = frameCaptures.map((cap) => cap.videoPath || "");
    const hasMissing = slotVideoPaths.some((path) => !path);
    if (!hasMissing) {
      return slotVideoPaths;
    }

    const selectedSet = new Set(
      selectedCaptureIndexes.filter((idx) => Number.isInteger(idx)),
    );

    const unselectedCandidates = allCaptures
      .map((cap, idx) => ({ idx, videoPath: cap.videoPath || "" }))
      .filter((item) => !selectedSet.has(item.idx) && !!item.videoPath);

    // Shuffle once per session so fallback is random and non-repeating.
    for (let i = unselectedCandidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unselectedCandidates[i], unselectedCandidates[j]] = [
        unselectedCandidates[j],
        unselectedCandidates[i],
      ];
    }

    let fallbackIdx = 0;
    const fallbackAssignments: Array<{
      slotIndex: number;
      fallbackCaptureIndex: number;
    }> = [];
    const resolvedBySlot = slotVideoPaths.map((path, slotIndex) => {
      if (path) return path;
      if (fallbackIdx >= unselectedCandidates.length) return "";
      const selectedFallback = unselectedCandidates[fallbackIdx];
      const fallbackPath = selectedFallback.videoPath;
      fallbackAssignments.push({
        slotIndex,
        fallbackCaptureIndex: selectedFallback.idx,
      });
      fallbackIdx += 1;
      return fallbackPath;
    });

    if (!hasLoggedMissingVideoRef.current) {
      const diagnosticsByCapture = new Map(
        captureVideoDiagnostics.map((d) => [d.captureIndex, d]),
      );

      const missingSlots = slotVideoPaths
        .map((path, slotIndex) => {
          if (path) return null;
          const captureIndex = selectedCaptureIndexes[slotIndex];
          const diagnostic = diagnosticsByCapture.get(captureIndex);
          return {
            slotIndex,
            selectedCaptureIndex: captureIndex,
            reason: diagnostic?.reason || "unknown",
            blobSize: diagnostic?.blobSize ?? -1,
            cameraType: diagnostic?.cameraType || "unknown",
          };
        })
        .filter((item): item is {
          slotIndex: number;
          selectedCaptureIndex: number;
          reason: string;
          blobSize: number;
          cameraType: string;
        } => item !== null);

      console.warn("[Video Slot Fallback Summary]", {
        missingSlots,
        fallbackAssignments,
      });
      hasLoggedMissingVideoRef.current = true;
    }

    return resolvedBySlot;
  }, [allCaptures, captureVideoDiagnostics, frameCaptures, selectedCaptureIndexes]);

  const composeFrame = useCallback(async () => {
    try {
      setStatusText("กำลังรวมรูปภาพ...");
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

    const transactionId = state.transactionId || state.referenceId || state.transaction_id || "";
    if (!transactionId) return;
    hasCreatedPresign.current = true;

    const createPresignSession = async () => {
      try {
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

  // 🚨 1. ทำการสร้างรูป, สร้างวิดีโอ และเซฟลงเครื่องแยกต่างหาก (เป็นอิสระจากการอัปโหลด)
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const processMedia = async () => {
      const txId = state.transactionId || state.referenceId || new Date().getTime();

      // =====================================
      // 1. จัดการรูปภาพ (รวมกรอบ + เซฟ + ปริ้นท์)
      // =====================================
      const composedImg = await composeFrame();
      if (composedImg) {
        // เซฟรูปที่รวมกรอบแล้ว
        try {
          await invoke("save_to_local_drive", {
            imageDataBase64: composedImg,
            filename: `BonioBooth_${txId}_Frame.jpg`, 
          });
        } catch (err) { console.error(err); }

        // เซฟรูปเดี่ยวทุกรูป
        for (let i = 0; i < frameCaptures.length; i++) {
          if (frameCaptures[i].photo) {
            try {
              await invoke("save_to_local_drive", {
                imageDataBase64: frameCaptures[i].photo,
                filename: `BonioBooth_${txId}_Photo_${i + 1}.jpg`,
              });
            } catch (err) { console.error(err); }
          }
        }
        console.log("✅ [PhotoResult] Saved all photos to local drive successfully!");

        // สั่งปริ้นท์ทันทีที่รูปเสร็จ (ไม่ต้องรอวิดีโอ)
        printFrame(composedImg, quantity);
      }

      // =====================================
      // 2. จัดการวิดีโอ (รวมเฟรม + เซฟ)
      // =====================================
      let composedVid = "";
      const resolvedVideoBySlot = buildVideoPathsBySlot();
      const slotVideoPairs = slots
        .map((slot, idx) => ({ slot, videoPath: resolvedVideoBySlot[idx] || "" }))
        .filter((pair) => !!pair.videoPath);

      const videoPaths = slotVideoPairs.map((pair) => pair.videoPath);
      const videoSlots = slotVideoPairs.map((pair) => pair.slot);

      if (videoPaths.length > 0) {
        setStatusText("กำลังรวมวิดีโอ...");
        try {
          let lutPath: string | null = null;
          if (selectedFilter && selectedFilter.type === "lut" && selectedFilter.lutFile) {
            try {
              lutPath = await invoke<string>("resolve_lut_path", {
                lutFile: selectedFilter.lutFile,
              });
            } catch (err) {}
          }

          composedVid = await invoke("compose_frame_video", {
            frameImageUrl: selectedFrame?.imageUrl || "",
            videoPaths,
            slots: videoSlots,
            frameWidth: frameWidth,
            frameHeight: frameHeight,
            outputFilename: "framed-video.mp4",
            lutPath: lutPath,
          });

          // เซฟวิดีโอลงเครื่อง
          try {
            await invoke("copy_video_to_local_drive", {
              sourcePath: composedVid,
              filename: `BonioBooth_${txId}_Video.mp4`, 
            });
            console.log("✅ [PhotoResult] Saved video to local drive successfully!");
          } catch (err) { console.error(err); }

        } catch (err) {
          console.error("Video compose failed:", err);
        }
      }

      // ตั้งค่าให้รู้ว่าการประมวลผลไฟล์ทั้งหมดพร้อมสำหรับการอัปโหลดแล้ว
      setFinalVideoPath(composedVid);
      setMediaReady(true);
    };

    processMedia();
  }, [
    buildVideoPathsBySlot,
    composeFrame,
    frameCaptures,
    frameHeight,
    frameWidth,
    quantity,
    selectedFilter,
    selectedFrame,
    slots,
    state.referenceId,
    state.transactionId,
  ]);

  // 🚨 2. อัปโหลดเมื่อไฟล์พร้อมและได้รับ Session ID แล้วเท่านั้น
  const uploadFiles = useCallback(async () => {
    if (hasUploadedFiles.current) return;
    if (!mediaReady || !sessionId || uploadUrls.length === 0) return;
    
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

      const uploadedFiles: { key: string; type: string; order: number }[] = [];
      let photoIdx = 0;

      // อัปโหลดรูปที่รวมกรอบแล้ว
      if (photoIdx < photoUrls.length && composedImage) {
        setStatusText("กำลังอัปโหลดรูปเฟรม...");
        const composedPath: string = await invoke("save_temp_image", {
          imageDataBase64: composedImage,
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

      // อัปโหลดรูปเดี่ยว
      for (let i = 0; i < frameCaptures.length && photoIdx < photoUrls.length; i++) {
        if (!frameCaptures[i].photo) continue;
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
        } catch (err) {}
        photoIdx++;
      }

      // อัปโหลดวิดีโอ
      if (videoUrls.length > 0 && finalVideoPath) {
        setStatusText("กำลังอัปโหลดวิดีโอ...");
        try {
          await invoke("upload_to_presigned_url", {
            url: videoUrls[0].uploadUrl,
            filePath: finalVideoPath,
            contentType: "video/mp4",
          });
          uploadedFiles.push({
            key: videoUrls[0].key,
            type: "video",
            order: videoUrls[0].order,
          });
        } catch (err) {}
      }

      // คอนเฟิร์มการอัปโหลด
      if (uploadedFiles.length > 0) {
        try {
          await invoke("confirm_upload", {
            sessionId,
            uploadedFiles,
          });
        } catch (err) {}
      }

      setUploadStatus("done");
      setStatusText("อัปโหลดเสร็จสิ้น!");
    } catch (err) {
      setUploadStatus("error");
      hasUploadedFiles.current = false; 
    }
  }, [sessionId, uploadUrls, composedImage, finalVideoPath, frameCaptures, mediaReady]);

  // ดักจับและเรียกใช้ Upload เมื่อทุกอย่างพร้อม
  useEffect(() => {
    if (mediaReady && sessionId && uploadUrls.length > 0 && !hasUploadedFiles.current) {
      uploadFiles();
    }
  }, [mediaReady, sessionId, uploadUrls, uploadFiles]);

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
        const orientationKey = isLandscape ? "landscape" : "portrait";
        const selectedPaperSize = getPaperSize(orientationKey);
        const cutMode =
          (frameType === "2x6" && selectedPaperSize === "2x6") ||
          (frameType === "6x2" && selectedPaperSize === "6x2")
            ? "cut"
            : "no-cut";
        try {
          const config = getPaperConfig(orientationKey);
          if (config) {
            scale = config.scale ?? 100;
            verticalOffset = config.vertical ?? 0;
            horizontalOffset = config.horizontal ?? 0;
          }
        } catch {}

        let printerName = getSelectedPrinter();

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
          
          await new Promise(resolve => setTimeout(resolve, 100));

          try {
            for (let i = 0; i < printQuantity; i++) {
              await invoke("print_photo", {
                imagePath: printPath,
                printerName,
                frameType,
                paperType: getPaperTypeByOrientation(
                  orientationKey,
                ),
                cutMode,
                scale,
                verticalOffset,
                horizontalOffset,
                isLandscape,
                borderless: BORDERLESS_PRINT,
              });
            }

            await invoke("reduce_paper_level", { copies: printQuantity });
            setPrintStatus("done");
          } finally {
            setPrinting(false);
          }
        } else {
          setPrintStatus("no-printer");
        }
      } catch (err) {
        setPrintStatus("error");
        setPrinting(false);
      }
    },
    [frameWidth, frameHeight],
  );

  useEffect(() => {
    const checkPrinter = setInterval(async () => {
      try {
        const printers: any[] = await invoke("get_printers");
        const hasPrinter = printers.some((p: any) => p.is_online);
        if (!hasPrinter && printStatus === "printing") {
          setError("เครื่องปริ้นถูกถอดออก กรุณาเชื่อมต่อใหม่");
          setTimeout(() => navigate("/"), 3000);
        }
      } catch {}
    }, 5000);

    return () => clearInterval(checkPrinter);
  }, [printStatus, navigate]);

  const handleHome = () => {
    navigate("/");
  };

  // เปิด modal พิมพ์ซ้ำ — countdown หน้านี้จะถูก pause (ยึดเวลาตาม modal แทน)
  const handleOpenReprint = () => {
    if (!composedImage) return;
    setShowReprintModal(true);
  };

  // ปิด modal โดยไม่มีการชำระเงิน (ยกเลิก/ครบ 5 นาที) → เริ่มนับ countdown ใหม่ตาม flow เดิม
  const handleReprintClose = useCallback(() => {
    setShowReprintModal(false);
    setCountdownKey((k) => k + 1);
  }, []);

  // ชำระเงินสำเร็จ → พิมพ์รูปเดิมซ้ำตามจำนวน (ไม่อัปโหลดใหม่) แล้วเริ่มนับ countdown ใหม่
  const handleReprintPaid = useCallback(
    async ({ quantity: reprintQty }: { transactionId: string; quantity: number }) => {
      setShowReprintModal(false);
      setCountdownKey((k) => k + 1);
      if (composedImage) {
        await printFrame(composedImage, reprintQty);
      }
    },
    // printFrame เป็น useCallback ที่ผูกกับ frameWidth/frameHeight เท่านั้น
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composedImage],
  );

  const isUploading = uploadStatus === "processing" || uploadStatus === "uploading";

  return (
    <div
      className="page-container"
      style={{
        backgroundImage: `url(${theme.backgroundSecond})`,
        justifyContent: "flex-start",
        padding: "65px 0 10px",
      }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
    >
      <Countdown
        key={countdownKey}
        seconds={COUNTDOWN.PHOTO_RESULT.DURATION}
        onComplete={handleHome}
        visible={COUNTDOWN.PHOTO_RESULT.VISIBLE}
        paused={showReprintModal}
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

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4px 24px",
          width: "100%",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {composedImage ? (
          <div
            style={{
              height: "100%",
              maxWidth: "90%",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              aspectRatio: `${frameWidth} / ${frameHeight}`,
            }}
          >
            <img
              src={composedImage}
              alt="Final Photo"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
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

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 20,
          width: "100%",
          padding: "0 24px",
          justifyContent: "center",
        }}
      >
        <button
          className="primary-button"
          onClick={handleOpenReprint}
          disabled={!composedImage || printStatus === "printing"}
          style={{
            flex: 1,
            maxWidth: 260,
            background: "#fff",
            color: theme.primaryColor,
            border: `2px solid ${theme.primaryColor}`,
            cursor: !composedImage || printStatus === "printing" ? "not-allowed" : "pointer",
            opacity: !composedImage || printStatus === "printing" ? 0.6 : 1,
            transition: "all 0.3s ease",
          }}
        >
          🖨️ พิมพ์อีกครั้ง / PRINT AGAIN
        </button>

        <button
          className="primary-button"
          onClick={handleHome}
          disabled={isUploading}
          style={{
            flex: 1,
            maxWidth: 260,
            background: isUploading ? "#888888" : theme.primaryColor,
            color: theme.textButtonColor,
            cursor: isUploading ? "not-allowed" : "pointer",
            opacity: isUploading ? 0.7 : 1,
            transition: "all 0.3s ease",
          }}
        >
          {isUploading ? "⏳ กำลังอัปโหลด..." : "กลับหน้าหลัก / HOME"}
        </button>
      </div>

      {showReprintModal && (
        <PrintAgainModal
          theme={theme}
          machineData={machineData}
          originalTransactionId={originalTransactionId}
          onClose={handleReprintClose}
          onPaid={handleReprintPaid}
        />
      )}
      <ContextMenu
        open={showContextMenu}
        onClose={() => setShowContextMenu(false)}
        onFormatReset={onFormatReset}
        onBeforeClose={onBeforeClose}
      />
    </div>
  );
}