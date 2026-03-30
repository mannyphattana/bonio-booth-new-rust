import type { FrameData } from "../App";

const A4_WIDTH = 2480;
const A4_HEIGHT = 3508;

const SLOT_X = 120;
const SLOT_Y = 120;
const SLOT_W = A4_WIDTH - SLOT_X * 2;
const SLOT_H = A4_HEIGHT - SLOT_Y * 2;

// Real one-piece overlay: center area is transparent so captured photo is visible.
const a4OnePieceOverlaySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${A4_WIDTH}" height="${A4_HEIGHT}" viewBox="0 0 ${A4_WIDTH} ${A4_HEIGHT}">
  <rect x="0" y="0" width="${A4_WIDTH}" height="${A4_HEIGHT}" fill="transparent"/>
  <rect x="8" y="8" width="${A4_WIDTH - 16}" height="${A4_HEIGHT - 16}" fill="none" stroke="#ff364d" stroke-width="16"/>
  <rect x="${SLOT_X}" y="${SLOT_Y}" width="${SLOT_W}" height="${SLOT_H}" fill="none" stroke="#ff364d" stroke-width="8"/>
  <rect x="${A4_WIDTH - 290}" y="36" width="240" height="96" fill="#ff364d" rx="2"/>
  <text x="${A4_WIDTH - 170}" y="84" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#ffffff">A4</text>
</svg>`;

// Preview image for carousel/selection (keeps paper-look while real overlay stays transparent).
const a4OnePiecePreviewSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${A4_WIDTH}" height="${A4_HEIGHT}" viewBox="0 0 ${A4_WIDTH} ${A4_HEIGHT}">
  <rect x="0" y="0" width="${A4_WIDTH}" height="${A4_HEIGHT}" fill="#dcdcdc"/>
  <rect x="8" y="8" width="${A4_WIDTH - 16}" height="${A4_HEIGHT - 16}" fill="none" stroke="#ff364d" stroke-width="16"/>
  <rect x="${SLOT_X}" y="${SLOT_Y}" width="${SLOT_W}" height="${SLOT_H}" fill="none" stroke="#ff364d" stroke-width="8"/>
  <line x1="${SLOT_X}" y1="${SLOT_Y}" x2="${SLOT_X + SLOT_W}" y2="${SLOT_Y + SLOT_H}" stroke="rgba(120,120,120,0.7)" stroke-width="6"/>
  <line x1="${SLOT_X + SLOT_W}" y1="${SLOT_Y}" x2="${SLOT_X}" y2="${SLOT_Y + SLOT_H}" stroke="rgba(120,120,120,0.7)" stroke-width="6"/>
  <line x1="${A4_WIDTH / 2}" y1="${SLOT_Y}" x2="${A4_WIDTH / 2}" y2="${SLOT_Y + SLOT_H}" stroke="rgba(120,120,120,0.7)" stroke-width="6"/>
  <rect x="${A4_WIDTH / 2 - 110}" y="${A4_HEIGHT / 2 - 80}" width="220" height="160" fill="#ff364d" rx="2"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="88" font-weight="700" fill="#ffffff">A4</text>
</svg>`;

const encodeSvg = (svg: string): string =>
  `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

const a4OnePieceImage = encodeSvg(a4OnePieceOverlaySvg);
const a4OnePiecePreview = encodeSvg(a4OnePiecePreviewSvg);

export const A4_ONE_PIECE_FRAME: FrameData = {
  _id: "local-a4-one-piece-frame",
  name: "A4 One Piece",
  code: "LOCAL-A4-ONE-PIECE",
  imageUrl: a4OnePieceImage,
  previewUrl: a4OnePiecePreview,
  imageSize: `${A4_WIDTH}x${A4_HEIGHT}`,
  orientation: "portrait",
  grid: {
    width: A4_WIDTH,
    height: A4_HEIGHT,
    slots: [
      {
        x: SLOT_X,
        y: SLOT_Y,
        width: SLOT_W,
        height: SLOT_H,
        radius: 0,
        zIndex: -1,
      },
    ],
  },
};
