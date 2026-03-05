import { useState, useCallback, useEffect, useRef } from "react";

export function useContextMenu() {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🚨 1. บล็อกการคลิกขวาทั่วทั้งระบบทิ้งไปเลย 100% (ฆ่าทิ้งถาวร)
  useEffect(() => {
    const blockContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("contextmenu", blockContext, { capture: true });
    return () => window.removeEventListener("contextmenu", blockContext, { capture: true });
  }, []);

  // 🚨 2. สร้างระบบ "จิ้มมุมขวาบน 5 ครั้งติดกัน" เพื่อเรียกเมนูตั้งค่า
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // กำหนดโซนความกว้างมุมขวาบน (กว้าง 200px, สูง 200px)
      const isTopRight = e.clientX >= window.innerWidth - 200 && e.clientY <= 200;

      if (isTopRight) {
        clickCountRef.current += 1;

        // ถ้านับครบ 5 ครั้งรวด ให้เปิดเมนู
        if (clickCountRef.current >= 5) {
          setShowContextMenu(true);
          clickCountRef.current = 0; // รีเซ็ตค่า
        }

        // เริ่มจับเวลา ถ้าทิ้งช่วงเกิน 1 วินาที ให้รีเซ็ตการนับใหม่ (ต้องเคาะ 5 ทีเร็วๆ)
        if (clickTimerRef.current) {
          clearTimeout(clickTimerRef.current);
        }
        clickTimerRef.current = setTimeout(() => {
          clickCountRef.current = 0;
        }, 1000);

      } else {
        // ถ้าลูกค้าไปจิ้มตรงอื่นของหน้าจอ ให้รีเซ็ตการนับทันที (กันการจิ้มมั่ว)
        clickCountRef.current = 0;
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, { capture: true });
    return () => window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
  }, []);

  // ปล่อย 2 ฟังก์ชันนี้ให้ว่างไว้ เพื่อไม่ให้หน้าอื่นๆ ที่เรียกใช้เกิด Error
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleTouchStart = useCallback(() => {}, []);

  return {
    showContextMenu,
    setShowContextMenu,
    handleContextMenu,
    handleTouchStart,
  };
}