import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  LutPreviewRenderer,
  decodeLutBase64,
  type LutFrameSource,
} from "../utils/lutPreview";

interface Props {
  /** <video> ของ webcam หรือ <img> live view ของ Canon ที่จะเอาเฟรมมาเกรดสี */
  sourceRef: React.RefObject<LutFrameSource | null>;
  /** path ของไฟล์ .cube (ว่าง = ยังหาไม่เจอ) */
  lutPath: string;
  /** ความละเอียดที่วาด (ค่าเริ่มต้น 1280x720 — ยืดตาม CSS อยู่แล้ว) */
  width?: number;
  height?: number;
  style?: React.CSSProperties;
  /** ยิงกลับเมื่อพร้อมวาด/วาดไม่ได้ ให้ผู้เรียกตัดสินใจว่าจะโชว์ภาพดิบไหม */
  onReadyChange?: (ready: boolean) => void;
}

/**
 * canvas ที่เอาเฟรมจากกล้องมารัน LUT ตัวจริงบน GPU แล้ววาดออก
 * ถ้าเครื่องไม่รองรับ WebGL2 หรือโหลด LUT ไม่ได้ จะรายงาน ready=false
 * ให้ผู้เรียก fallback ไปโชว์ภาพสดแบบไม่มีฟิลเตอร์
 */
export default function LutLivePreview({
  sourceRef,
  lutPath,
  width = 1280,
  height = 720,
  style,
  onReadyChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LutPreviewRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  const onReadyChangeRef = useRef(onReadyChange);
  useEffect(() => {
    onReadyChangeRef.current = onReadyChange;
  }, [onReadyChange]);

  useEffect(() => {
    onReadyChangeRef.current?.(ready);
  }, [ready]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      if (!lutPath || !canvasRef.current) return;
      try {
        const lut = await invoke<{ size: number; data_base64: string }>(
          "load_lut_texture",
          { lutFilePath: lutPath },
        );
        if (cancelled || !canvasRef.current) return;

        const renderer = LutPreviewRenderer.create(
          canvasRef.current,
          lut.size,
          decodeLutBase64(lut.data_base64),
        );
        if (!renderer) {
          console.warn("[LutLivePreview] WebGL2 not available — showing raw preview");
          return;
        }
        rendererRef.current = renderer;
        setReady(true);

        const loop = () => {
          rafRef.current = requestAnimationFrame(loop);
          const source = sourceRef.current;
          if (!source || !rendererRef.current) return;
          // ยังไม่มีเฟรมให้วาด (วิดีโอเพิ่งเริ่ม / รูปยังโหลดไม่เสร็จ)
          if (source instanceof HTMLVideoElement && source.readyState < 2) return;
          if (source instanceof HTMLImageElement && !source.complete) return;
          try {
            rendererRef.current.render(source, width, height);
          } catch (err) {
            console.error("[LutLivePreview] render failed:", err);
          }
        };
        loop();
      } catch (err) {
        console.error("[LutLivePreview] setup failed:", err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setReady(false);
    };
  }, [lutPath, sourceRef, width, height]);

  return <canvas ref={canvasRef} style={style} />;
}
