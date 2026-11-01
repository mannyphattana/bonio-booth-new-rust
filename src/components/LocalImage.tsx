import type { ImgHTMLAttributes } from "react";
import { useLocalImage } from "../utils/localImage";

/** <img> ที่ใช้ไฟล์ในเครื่องก่อน (ดู utils/localImage) — ใช้กับรูปกรอบที่มาจาก backend */
export default function LocalImage({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const localSrc = useLocalImage(src);
  return <img {...rest} src={localSrc || undefined} />;
}
