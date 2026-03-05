import { useState, useCallback, useEffect } from "react";

export function useContextMenu() {
  const [showContextMenu, setShowContextMenu] = useState(false);

  // 🚨 1. บล็อกการคลิกขวาทั่วทั้งระบบทิ้งไปเลย 100% (เพื่อป้องกันเมนูของ Windows)
  useEffect(() => {
    const blockContext = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("contextmenu", blockContext, { capture: true });
    return () => window.removeEventListener("contextmenu", blockContext, { capture: true });
  }, []);

  // 🚨 2. สร้าง "ปุ่มกุญแจลับใสๆ" แปะลอยไว้ที่มุมขวาบนของหน้าจอ
  useEffect(() => {
    // สร้างปุ่มลอย (Floating Element)
    const secretBtn = document.createElement("div");
    
    // ใส่รูปไอคอนแม่กุญแจ (SVG) สีขาวขอบดำบางๆ ให้พอมองเห็นลางๆ
    secretBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0px 0px 2px rgba(0,0,0,0.8));"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
    
    // ตกแต่งให้ปุ่มใส และอยู่มุมขวาบนเสมอ
    Object.assign(secretBtn.style, {
      position: "fixed",
      top: "15px",
      right: "15px",
      width: "50px",
      height: "50px",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      opacity: "0.15", // 🚨 ความใส 15% (มองแทบไม่เห็น ถ้าอยากให้ซ่อนกว่านี้เปลี่ยนเป็น 0.05 ได้ครับ)
      zIndex: "99999", // ให้อยู่บนสุดเสมอ
      cursor: "pointer",
      userSelect: "none",
      WebkitUserSelect: "none",
      WebkitTouchCallout: "none"
    });

    // เมื่อกดปุ่มกุญแจ ให้เปิดเมนู (ซึ่งจะติดหน้าจอให้ใส่รหัส 7053 ตามที่เราทำไว้)
    const handleTrigger = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      setShowContextMenu(true);
    };

    // ใช้ pointerdown เพื่อรองรับทั้งเมาส์และการจิ้ม
    secretBtn.addEventListener("pointerdown", handleTrigger);
    
    // แปะปุ่มลงไปในหน้าจอ
    document.body.appendChild(secretBtn);

    // ทำลายปุ่มทิ้งเมื่อเปลี่ยนหน้า ป้องกันปุ่มซ้อนกัน
    return () => {
      secretBtn.removeEventListener("pointerdown", handleTrigger);
      if (secretBtn.parentNode) {
        secretBtn.parentNode.removeChild(secretBtn);
      }
    };
  }, []);

  // ปล่อยว่างฟังก์ชันพวกนี้ไว้ ไม่ให้ Error
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