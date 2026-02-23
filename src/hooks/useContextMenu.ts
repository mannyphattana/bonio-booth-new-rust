import { useState, useCallback, useRef } from "react";

/**
 * Shared hook for right-click context menu support.
 * Blocks touch-triggered contextmenu (two-finger / long-press) on touchscreens
 * while still allowing mouse right-click from AnyDesk / physical mouse.
 */
export function useContextMenu() {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const touchActiveRef = useRef(false);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (touchActiveRef.current) return;
    setShowContextMenu(true);
  }, []);

  const handleTouchStart = useCallback(() => {
    touchActiveRef.current = true;
    setTimeout(() => {
      touchActiveRef.current = false;
    }, 800);
  }, []);

  return {
    showContextMenu,
    setShowContextMenu,
    handleContextMenu,
    handleTouchStart,
  };
}
