import { useState, useEffect, useRef, useCallback } from "react";
import { appLogger } from "../utils/appLogger";
import { logError } from "../utils/logger";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { QRCodeSVG } from "qrcode.react";
import type { ThemeData, MachineData, Capture, FrameSlot } from "../App";
import Countdown from "../components/Countdown";
import { COUNTDOWN } from "../config/appConfig";
import { setPrinting } from "../utils/printingState";
import { getPaperConfigForPrint } from "../utils/paperStore";
import { useContextMenu } from "../hooks/useContextMenu";
import ContextMenu from "../components/ContextMenu";
import {
  addPendingUpload,
  removePendingUpload,
  markUploadActive,
  markUploadInactive,
  type PendingUploadRecord,
} from "../utils/pendingUploadStore";

const CTX = "[PhotoResult]";

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

  // composedImage ตอนนี้เป็น 4x6 duplicate มาจาก compose_frame แล้ว (สำหรับกรอบ 2x6/6x2)
  // ใช้ค่านี้แค่คำนวณ aspectRatio ของ "กล่อง preview" ให้ตรงกับภาพจริงที่จะโชว์
  // (กันภาพถูกบีบแคบผิดสัดส่วนตอน object-fit: contain) — ไม่เกี่ยวกับ frameType ที่ส่งให้
  // print_photo ด้านล่าง ซึ่งยังต้องคำนวณจาก frameWidth/frameHeight เดิมเท่านั้น
  const composedAspectRatio = (() => {
    const ratio = frameWidth / frameHeight;
    if (ratio < 0.5) return (frameWidth * 2) / frameHeight; // 2x6 -> 4x6 (คอลัมน์คู่)
    if (ratio > 2) return frameWidth / (frameHeight * 2); // 6x2 -> 4x6 (แถวคู่)
    return ratio;
  })();

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

  const hasStarted = useRef(false);
  const hasCreatedPresign = useRef(false);
  const hasUploadedFiles = useRef(false);
  const hasLoggedMissingVideoRef = useRef(false);
  const localTxIdRef = useRef<string>("");
  const pendingRecordRef = useRef<PendingUploadRecord | null>(null);

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

      appLogger.warn(CTX, "[Video Slot Fallback Summary]", {
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
      appLogger.error(CTX, "Compose frame error:", err);
      logError(
        "compose_frame_failed",
        `compose_frame threw: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
        "error"
      );
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
          appLogger.info(CTX, "Presign OK — sessionId:", responseData.photoSession?.id, "files:", responseData.uploadUrls?.length);
          setQrCodeUrl(responseData.qrcodeStorageUrl);
          setSessionId(responseData.photoSession?.id || "");
          setUploadUrls(responseData.uploadUrls || []);
        } else {
          appLogger.warn(CTX, "Presign returned success=false or missing qrcodeStorageUrl", JSON.stringify(responseData));
          logError(
            "presign_upload_no_qr",
            `create_presign_upload returned success=false or missing qrcodeStorageUrl. transactionId=${transactionId}`,
            undefined,
            "warning"
          );
          hasCreatedPresign.current = false; 
        }
      } catch (err) {
        appLogger.error(CTX, "createPresignSession failed:", err);
        logError(
          "presign_upload_failed",
          `create_presign_upload threw: ${String(err)}`,
          err instanceof Error ? err.stack : undefined,
          "error"
        );
        hasCreatedPresign.current = false; 
      }
    };

    createPresignSession();
  }, [state?.transactionId, state?.referenceId]); 

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const processMedia = async () => {
      const txId = state.transactionId || state.referenceId || new Date().getTime();
      localTxIdRef.current = String(txId);

      const composedImg = await composeFrame();
      if (composedImg) {
        try {
          await invoke("save_to_local_drive", {
            imageDataBase64: composedImg,
            filename: `BonioBooth_${txId}_Frame.jpg`, 
          });
        } catch (err) {
          appLogger.error(CTX, "save_to_local_drive (frame) failed:", err);
          logError("save_local_photo_failed", `save_to_local_drive frame failed: ${String(err)}`, err instanceof Error ? err.stack : undefined, "warning");
        }

        for (let i = 0; i < frameCaptures.length; i++) {
          if (frameCaptures[i].photo) {
            try {
              await invoke("save_to_local_drive", {
                imageDataBase64: frameCaptures[i].photo,
                filename: `BonioBooth_${txId}_Photo_${i + 1}.jpg`,
              });
            } catch (err) {
              appLogger.error(CTX, `save_to_local_drive (photo ${i + 1}) failed:`, err);
              logError("save_local_photo_failed", `save_to_local_drive photo ${i + 1} failed: ${String(err)}`, err instanceof Error ? err.stack : undefined, "warning");
            }
          }
        }
        appLogger.info(CTX, "✅ [PhotoResult] Saved all photos to local drive successfully!");

        printFrame(composedImg, quantity);
      }

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
            hflipVideo:
              localStorage.getItem("cameraType") !== "canon" &&
              localStorage.getItem("mirrorMode") === "false",
          });

          try {
            await invoke("copy_video_to_local_drive", {
              sourcePath: composedVid,
              filename: `BonioBooth_${txId}_Video.mp4`, 
            });
            appLogger.info(CTX, "✅ [PhotoResult] Saved video to local drive successfully!");
          } catch (err) {
            appLogger.error(CTX, "copy_video_to_local_drive failed:", err);
            logError("save_local_video_failed", `copy_video_to_local_drive failed: ${String(err)}`, err instanceof Error ? err.stack : undefined, "warning");
          }

        } catch (err) {
          appLogger.error(CTX, "Video compose failed:", err);
          logError(
            "compose_video_failed",
            `compose_frame_video threw: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
            "error"
          );
        }
      }

      if (composedImg) {
        try {
          const LOCAL_SAVE_DIR = "C:\\boniobooth\\Saved_Photos";
          const txIdStr = String(txId);
          const pendingFiles: import("../utils/pendingUploadStore").PendingUploadFile[] = [];

          pendingFiles.push({
            type: "frame",
            localPath: `${LOCAL_SAVE_DIR}\\BonioBooth_${txIdStr}_Frame.jpg`,
            order: 0,
            contentType: "image/jpeg",
          });

          for (let i = 0; i < frameCaptures.length; i++) {
            if (frameCaptures[i].photo) {
              pendingFiles.push({
                type: "photo",
                localPath: `${LOCAL_SAVE_DIR}\\BonioBooth_${txIdStr}_Photo_${i + 1}.jpg`,
                order: i + 1,
                contentType: "image/jpeg",
              });
            }
          }

          if (composedVid) {
            pendingFiles.push({
              type: "video",
              localPath: `${LOCAL_SAVE_DIR}\\BonioBooth_${txIdStr}_Video.mp4`,
              order: 0,
              contentType: "video/mp4",
            });
          }

          const transactionIdForRecord = state.transactionId || state.referenceId || "";
          const transactionCodeForRecord = state.referenceId
            ? state.referenceId.startsWith("TXN-")
              ? state.referenceId
              : `TXN-${state.referenceId}`
            : undefined;

          pendingRecordRef.current = {
            txId: txIdStr,
            transactionId: transactionIdForRecord,
            transactionCode: transactionCodeForRecord,
            createdAt: new Date().toISOString(),
            files: pendingFiles,
            retryCount: 0,
          };
          appLogger.info(CTX, `[PhotoResult] PendingUploadRecord prepared (not committed) — txId=${txIdStr} files=${pendingFiles.length}`);
        } catch (err) {
          appLogger.warn(CTX, "prepare PendingUploadRecord failed (non-blocking):", err);
        }
      }

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

  const uploadFiles = useCallback(async () => {
    if (hasUploadedFiles.current) return;
    if (!mediaReady || !sessionId || uploadUrls.length === 0) return;
    
    hasUploadedFiles.current = true;

    markUploadActive(localTxIdRef.current);

    const queueForRetry = (reason: string) => {
      if (!pendingRecordRef.current) return;
      try {
        addPendingUpload(pendingRecordRef.current);
        appLogger.warn(
          CTX,
          `Queued pending upload for retry (${reason}) — txId=${pendingRecordRef.current.txId}`
        );
      } catch (err) {
        appLogger.warn(CTX, "queueForRetry addPendingUpload failed:", err);
      }
    };

    try {
      appLogger.info(CTX, "Upload started — sessionId:", sessionId, "uploadUrls:", uploadUrls.length);
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
          appLogger.info(CTX, "Uploaded frame photo OK — key:", photoUrls[photoIdx].key);
          uploadedFiles.push({
            key: photoUrls[photoIdx].key,
            type: "photo",
            order: photoUrls[photoIdx].order,
          });
        } catch (err) {
          appLogger.error(CTX, "Upload frame photo failed:", err);
          logError(
            "upload_photo_frame_failed",
            `upload_to_presigned_url (frame photo) failed: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
            "error"
          );
        }
        photoIdx++;
      }

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
          appLogger.info(CTX, `Uploaded photo ${i + 1} OK — key:`, photoUrls[photoIdx].key);
          uploadedFiles.push({
            key: photoUrls[photoIdx].key,
            type: "photo",
            order: photoUrls[photoIdx].order,
          });
        } catch (err) {
          appLogger.error(CTX, `Upload photo ${i + 1} failed:`, err);
          logError(
            "upload_photo_failed",
            `upload_to_presigned_url (photo ${i + 1}) failed: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
            "error"
          );
        }
        photoIdx++;
      }

      if (videoUrls.length > 0 && finalVideoPath) {
        setStatusText("กำลังอัปโหลดวิดีโอ...");
        try {
          await invoke("upload_to_presigned_url", {
            url: videoUrls[0].uploadUrl,
            filePath: finalVideoPath,
            contentType: "video/mp4",
          });
          appLogger.info(CTX, "Uploaded video OK — key:", videoUrls[0].key);
          uploadedFiles.push({
            key: videoUrls[0].key,
            type: "video",
            order: videoUrls[0].order,
          });
        } catch (err) {
          appLogger.error(CTX, "Upload video failed:", err);
          logError(
            "upload_video_failed",
            `upload_to_presigned_url (video) failed: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
            "error"
          );
        }
      }

      if (uploadedFiles.length > 0) {
        try {
          await invoke("confirm_upload", {
            sessionId,
            uploadedFiles,
          });
          appLogger.info(CTX, "confirm_upload OK — files:", uploadedFiles.length);
          pendingRecordRef.current = null;
          if (localTxIdRef.current) {
            removePendingUpload(localTxIdRef.current);
            appLogger.info(CTX, "PendingUploadRecord cleared — txId:", localTxIdRef.current);
          }
        } catch (err) {
          appLogger.error(CTX, "confirm_upload failed:", err);
          logError(
            "confirm_upload_failed",
            `confirm_upload failed: ${String(err)}`,
            err instanceof Error ? err.stack : undefined,
            "error"
          );
          queueForRetry("confirm_upload failed");
        }
      } else {
        appLogger.warn(CTX, "No files uploaded — skipping confirm_upload");
        logError("upload_no_files", "uploadFiles completed but no files were uploaded successfully", undefined, "warning");
        queueForRetry("no files uploaded");
      }

      appLogger.info(CTX, "Upload done — total files uploaded:", uploadedFiles.length);
      setUploadStatus("done");
      setStatusText("อัปโหลดเสร็จสิ้น!");
    } catch (err) {
      appLogger.error(CTX, "uploadFiles outer error:", err);
      logError(
        "upload_files_failed",
        `uploadFiles threw unexpected error: ${String(err)}`,
        err instanceof Error ? err.stack : undefined,
        "error"
      );
      queueForRetry("uploadFiles threw");
      setUploadStatus("error");
      hasUploadedFiles.current = false;
    } finally {
      markUploadInactive(localTxIdRef.current);
    }
  }, [sessionId, uploadUrls, composedImage, finalVideoPath, frameCaptures, mediaReady]);

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
        try {
          const config = await getPaperConfigForPrint(isLandscape);
          scale = config.scale;
          verticalOffset = config.vertical;
          horizontalOffset = config.horizontal;
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
          appLogger.info(CTX, "Print started — printer:", printerName, "frameType:", frameType, "qty:", printQuantity);
          const printTimeout = printQuantity * 45000; 
          setPrinting(true, printTimeout);
          
          await new Promise(resolve => setTimeout(resolve, 100));

          try {
            for (let i = 0; i < printQuantity; i++) {
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
            appLogger.info(CTX, "Print done — qty:", printQuantity);
            setPrintStatus("done");
          } catch (err) {
            appLogger.error(CTX, "print_photo failed:", err);
            logError(
              "print_failed",
              `print_photo failed: ${String(err)} (printer=${printerName}, frameType=${frameType}, qty=${printQuantity})`,
              err instanceof Error ? err.stack : undefined,
              "error"
            );
            setPrintStatus("error");
          } finally {
            setPrinting(false);
          }
        } else {
          appLogger.warn(CTX, "No printer found — skipping print");
          logError("print_no_printer", "No printer available — print skipped", undefined, "warning");
          setPrintStatus("no-printer");
        }
      } catch (err) {
        appLogger.error(CTX, "printFrame outer error:", err);
        logError(
          "print_frame_failed",
          `printFrame threw unexpected error: ${String(err)}`,
          err instanceof Error ? err.stack : undefined,
          "error"
        );
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
              aspectRatio: `${composedAspectRatio}`,
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
