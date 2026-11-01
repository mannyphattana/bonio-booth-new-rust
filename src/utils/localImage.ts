/**
 * รูปจาก URL (กรอบ, รูปตัวอย่างกรอบ, wallpaper) ให้ใช้จากที่เก็บในเครื่องก่อน
 *
 * Rust เก็บไฟล์ไว้ที่ C:\boniobooth\Frames — มีแล้วก็ไม่ต้องดึงจาก CDN ซ้ำทุกครั้ง
 * และยังขึ้นได้แม้เน็ตตู้หลุด ถ้ายังไม่มีในเครื่อง ใช้ URL เดิมไปก่อน
 * (Rust โหลดลงเครื่องเบื้องหลังให้ ครั้งหน้าก็มี)
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** URL → blob URL ของไฟล์ในเครื่อง (อยู่ได้ตลอดอายุแอป ใช้ข้ามหน้าได้) */
const resolved = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

function needsLookup(url: string): boolean {
  return /^https?:\/\//.test(url);
}

/** src ที่ใช้แสดงผลได้ทันที: ไฟล์ในเครื่องถ้ามี ไม่งั้น URL เดิม */
export function localImageSrc(url: string | null | undefined): Promise<string> {
  if (!url || !needsLookup(url)) return Promise.resolve(url || "");
  const done = resolved.get(url);
  if (done) return Promise.resolve(done);

  let p = pending.get(url);
  if (!p) {
    p = invoke<ArrayBuffer>("get_local_image", { url })
      .then((buf) => {
        const src = URL.createObjectURL(new Blob([buf]));
        resolved.set(url, src);
        return src;
      })
      // ยังไม่มีในเครื่อง — ใช้ URL เดิมรอบนี้ ครั้งหน้าที่ขอจะลองในเครื่องใหม่
      .catch(() => url)
      .finally(() => pending.delete(url));
    pending.set(url, p);
  }
  return p;
}

/**
 * hook สำหรับ <img src> / backgroundImage — คืน "" ระหว่างเช็คในเครื่อง (ไม่กี่ ms)
 * เพื่อไม่ให้ browser เริ่มดึง URL จากเน็ตไปก่อนโดยเปล่าประโยชน์
 */
export function useLocalImage(url: string | null | undefined): string {
  const [src, setSrc] = useState(() => (url ? resolved.get(url) ?? "" : ""));

  useEffect(() => {
    let alive = true;
    const done = url ? resolved.get(url) : undefined;
    setSrc(done ?? (url && needsLookup(url) ? "" : url || ""));
    if (!done) {
      localImageSrc(url).then((s) => {
        if (alive) setSrc(s);
      });
    }
    return () => {
      alive = false;
    };
  }, [url]);

  return src;
}
