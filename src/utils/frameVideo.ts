/**
 * วิดีโอเฟรม: กติกาที่หน้าเลือกฟิลเตอร์ (เตรียมคลิป) กับหน้าผลลัพธ์ (ประกอบวิดีโอ) ต้องใช้ตรงกัน
 */

import { invoke } from "@tauri-apps/api/core";
import type { Capture } from "../App";
import { appLogger } from "./appLogger";

/** กลับซ้ายขวาคลิป: webcam ที่ปิดโหมดกระจก (ภาพนิ่งไม่กลับ คลิปต้องไม่กลับตาม) */
export function frameVideoHflip(): boolean {
  return localStorage.getItem("cameraType") !== "canon" && localStorage.getItem("mirrorMode") === "false";
}

/** ขนาดเฟรมที่ใช้คิดตำแหน่งช่อง (เหมือนหน้าผลลัพธ์) */
export function frameSize(selectedFrame: any): { frameWidth: number; frameHeight: number } {
  const [w, h] = (selectedFrame?.imageSize || "").split("x").map(Number);
  return {
    frameWidth: (w > 0 ? w : selectedFrame?.grid?.width) || 1200,
    frameHeight: (h > 0 ? h : selectedFrame?.grid?.height) || 1800,
  };
}

/**
 * ลูกค้าเลือกรูปลงช่องครบแล้ว: ให้ Rust ย่อ/ครอปคลิปแต่ละช่องไว้ก่อน (prepare_frame_video)
 * หน้าผลลัพธ์จะเหลือแค่วางคลิปลงเฟรม + ฟิลเตอร์ + เข้ารหัส — ทำไม่ทันหรือพังก็ไม่เป็นไร
 * หน้าผลลัพธ์ทำเองเหมือนเดิม (ช่องที่ไม่มีคลิป หน้าผลลัพธ์จะสุ่มคลิปอื่นมาใส่ ช่องนั้นไม่ได้เตรียม)
 */
export async function prepareFrameVideo(selectedFrame: any, frameCaptures: Capture[]): Promise<void> {
  const slots: any[] = selectedFrame?.grid?.slots || [];
  const pairs = slots
    .map((slot, i) => ({ slot, videoPath: frameCaptures[i]?.videoPath || "" }))
    .filter((p) => !!p.videoPath);
  if (!selectedFrame?.imageUrl || pairs.length === 0) return;
  const started = Date.now();
  try {
    const n = await invoke<number>("prepare_frame_video", {
      frameImageUrl: selectedFrame.imageUrl,
      videoPaths: pairs.map((p) => p.videoPath),
      slots: pairs.map((p) => p.slot),
      ...frameSize(selectedFrame),
      hflipVideo: frameVideoHflip(),
    });
    appLogger.info("[FrameVideo]", `prepared ${n}/${pairs.length} clips in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } catch (err) {
    appLogger.warn("[FrameVideo]", "clips not prepared (the result page makes the video as before):", err);
  }
}
