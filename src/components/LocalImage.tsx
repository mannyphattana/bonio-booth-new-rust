import { useState, type ImgHTMLAttributes } from "react";
import { useLocalImage } from "../utils/localImage";

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  /** กันที่ไว้ตอนรูปยังไม่ขึ้น กรอบในแถวจะได้ไม่ขยับตอนรูปมา */
  placeholderWidth?: number;
}

/**
 * <img> ที่ใช้ไฟล์ในเครื่องก่อน (ดู utils/localImage) — ใช้กับรูปกรอบที่มาจาก backend
 *
 * alt จะขึ้นก็ต่อเมื่อรูปเปิดไม่ได้จริงๆ ถ้าใส่ตั้งแต่แรก ระหว่างโหลดจะเห็น
 * ไอคอนรูปแตกกับชื่อกรอบ ดูเหมือนพังทั้งที่แค่ยังโหลดไม่เสร็จ
 */
export default function LocalImage({ src, alt, style, placeholderWidth, ...rest }: Props) {
  const localSrc = useLocalImage(src);
  const [loadedSrc, setLoadedSrc] = useState("");
  const [failedSrc, setFailedSrc] = useState("");
  const settled = !!localSrc && (loadedSrc === localSrc || failedSrc === localSrc);

  return (
    <img
      {...rest}
      src={localSrc || undefined}
      alt={localSrc && failedSrc === localSrc ? alt : ""}
      onLoad={() => setLoadedSrc(localSrc)}
      onError={() => setFailedSrc(localSrc)}
      style={settled ? style : { ...style, minWidth: placeholderWidth }}
    />
  );
}
