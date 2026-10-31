import { getCurrentWebview } from "@tauri-apps/api/webview";
import { appLogger } from "./appLogger";

const CTX = "[ViewportScale]";

/** The UI is laid out for a 720x1280 portrait window (see tauri.conf.json). */
export const DESIGN_WIDTH = 720;
export const DESIGN_HEIGHT = 1280;

/**
 * Zoom that fits the 720x1280 design into a portrait screen of the given size (CSS px at zoom 1).
 * Landscape screens stay at 1 — the booth is portrait-only and a landscape dev machine should not shrink.
 */
export function computeZoom(width: number, height: number): number {
  if (width <= 0 || height <= 0 || width > height) return 1;
  const zoom = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  // Floor to 2 decimals so rounding never pushes the layout past the screen edge.
  return Math.floor(zoom * 100) / 100;
}

let appliedZoom = 1;

async function applyZoom() {
  // innerWidth/innerHeight shrink by the zoom already applied; undo it to get the real screen size.
  const zoom = computeZoom(window.innerWidth * appliedZoom, window.innerHeight * appliedZoom);
  if (zoom === appliedZoom) return;
  try {
    await getCurrentWebview().setZoom(zoom);
    appliedZoom = zoom;
    appLogger.info(CTX, `zoom ${zoom} for ${window.innerWidth}x${window.innerHeight} CSS px`);
  } catch (err) {
    appLogger.error(CTX, "setZoom failed:", err);
  }
}

/** Scale the whole UI with the screen so a 1080x1920 (or 4K) portrait monitor shows the same layout as 720x1280. */
export function initViewportScale() {
  applyZoom();
  window.addEventListener("resize", () => applyZoom());
}
