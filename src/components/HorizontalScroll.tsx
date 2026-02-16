import { useRef, useState, useEffect, useCallback, type ReactNode, type CSSProperties } from "react";

interface Props {
  children: ReactNode;
  gap?: number;
  padding?: string;
  style?: CSSProperties;
  arrowColor?: string;
}

/**
 * Horizontally scrollable container with:
 * - Touch/mouse drag to scroll
 * - Left/right arrow buttons
 * - Arrows dim to 0.3 opacity when no more content in that direction
 */
export default function HorizontalScroll({
  children,
  gap = 12,
  padding = "0 16px",
  style,
  arrowColor = "#fff",
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Mouse drag state
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftStart = useRef(0);
  const hasDragged = useRef(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 2;
    setCanScrollLeft(el.scrollLeft > threshold);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - threshold);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows, children]);

  const scrollBy = (dir: number) => {
    scrollRef.current?.scrollBy({ left: dir * 200, behavior: "smooth" });
  };

  // Mouse drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    hasDragged.current = false;
    startX.current = e.pageX;
    scrollLeftStart.current = scrollRef.current?.scrollLeft ?? 0;
    document.body.style.userSelect = "none";
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current || !scrollRef.current) return;
    const dx = e.pageX - startX.current;
    if (Math.abs(dx) > 5) hasDragged.current = true;
    scrollRef.current.scrollLeft = scrollLeftStart.current - dx;
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.userSelect = "";
    // Prevent click events after drag
    if (hasDragged.current) {
      const handler = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
      };
      document.addEventListener("click", handler, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", handler, { capture: true }), 100);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const arrowBtnStyle = (enabled: boolean): CSSProperties => ({
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 44,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    border: "none",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.3,
    transition: "opacity 0.2s",
    zIndex: 5,
    padding: 0,
    color: arrowColor,
    fontSize: 28,
    fontWeight: 700,
    pointerEvents: "auto" as const,
  });

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        ...style,
      }}
    >
      {/* Left arrow */}
      <button
        onClick={() => scrollBy(-1)}
        style={{ ...arrowBtnStyle(canScrollLeft), left: 0 }}
        aria-label="Scroll left"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 6L9 12L15 18"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        onMouseDown={onMouseDown}
        style={{
          width: "100%",
          overflowX: "auto",
          overflowY: "hidden",
          padding,
          display: "flex",
          gap,
          flexShrink: 0,
          cursor: isDragging.current ? "grabbing" : "grab",
          scrollbarWidth: "thin",
          WebkitOverflowScrolling: "touch",
          scrollBehavior: "auto",
          msOverflowStyle: "auto",
        }}
      >
        {children}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scrollBy(1)}
        style={{ ...arrowBtnStyle(canScrollRight), right: 0 }}
        aria-label="Scroll right"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M9 6L15 12L9 18"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
