export type PrintProfile = "legacy_4x6" | "customer_a4";
export type PaperType = "photo_4x6" | "a4" | "a3";
export type PaperSizeOption = "2x6" | "4x6" | "6x2" | "6x4" | "a4" | "a3";

// สวิตช์เมนูเลือกกระดาษ A4/A3 ในหน้า Paper Position Config
// เปิดไว้ เพราะตู้นี้ (profile customer_a4) ใช้กระดาษ A4/A3 จริง แอดมินต้องเลือกได้
export const ENABLE_OFFICE_PAPER_MENU = true;

export interface PaperConfig {
  scale: number;
  vertical: number;
  horizontal: number;
}

export type PrintOrientation = "portrait" | "landscape";

const LEGACY_KEYS = {
  selectedPrinter: "selectedPrinter",
  paperConfigPortrait: "paperConfigPortrait",
  paperConfigLandscape: "paperConfigLandscape",
  paperSizePortrait: "paperSizePortrait",
  paperSizeLandscape: "paperSizeLandscape",
} as const;

// Branch CR profile for customer using normal printer + A4 paper.
export const ACTIVE_PRINT_PROFILE: PrintProfile = "customer_a4";

const PROFILE_PREFIX_BY_PROFILE: Record<PrintProfile, string> = {
  legacy_4x6: "",
  customer_a4: "customer_a4.",
};

const PROFILE_PREFIX = PROFILE_PREFIX_BY_PROFILE[ACTIVE_PRINT_PROFILE];

export const PRINT_STORAGE_KEYS = {
  selectedPrinter: `${PROFILE_PREFIX}selectedPrinter`,
  paperConfigPortrait: `${PROFILE_PREFIX}paperConfigPortrait`,
  paperConfigLandscape: `${PROFILE_PREFIX}paperConfigLandscape`,
  paperSizePortrait: `${PROFILE_PREFIX}paperSizePortrait`,
  paperSizeLandscape: `${PROFILE_PREFIX}paperSizeLandscape`,
} as const;

export const ACTIVE_PAPER_TYPE: PaperType =
  ACTIVE_PRINT_PROFILE === "customer_a4" ? "a3" : "photo_4x6";

const readStorageWithFallback = (activeKey: string, legacyKey: string): string | null => {
  const activeValue = localStorage.getItem(activeKey);
  if (activeValue !== null && activeValue !== "") return activeValue;

  if (activeKey === legacyKey) return activeValue;
  return localStorage.getItem(legacyKey);
};

export const getSelectedPrinter = (): string => {
  return readStorageWithFallback(
    PRINT_STORAGE_KEYS.selectedPrinter,
    LEGACY_KEYS.selectedPrinter,
  ) || "";
};

export const setSelectedPrinter = (printerName: string): void => {
  localStorage.setItem(PRINT_STORAGE_KEYS.selectedPrinter, printerName);
  // Keep legacy key in sync so values survive profile toggles/reverts.
  if (PRINT_STORAGE_KEYS.selectedPrinter !== LEGACY_KEYS.selectedPrinter) {
    localStorage.setItem(LEGACY_KEYS.selectedPrinter, printerName);
  }
};

export const getPaperConfig = (orientation: PrintOrientation): PaperConfig | null => {
  const activeKey =
    orientation === "landscape"
      ? PRINT_STORAGE_KEYS.paperConfigLandscape
      : PRINT_STORAGE_KEYS.paperConfigPortrait;
  const legacyKey =
    orientation === "landscape"
      ? LEGACY_KEYS.paperConfigLandscape
      : LEGACY_KEYS.paperConfigPortrait;

  const raw = readStorageWithFallback(activeKey, legacyKey);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return {
      scale: Number(parsed.scale),
      vertical: Number(parsed.vertical),
      horizontal: Number(parsed.horizontal),
    };
  } catch {
    return null;
  }
};

export const setPaperConfig = (
  orientation: PrintOrientation,
  config: PaperConfig,
): void => {
  const key =
    orientation === "landscape"
      ? PRINT_STORAGE_KEYS.paperConfigLandscape
      : PRINT_STORAGE_KEYS.paperConfigPortrait;

  const legacyKey =
    orientation === "landscape"
      ? LEGACY_KEYS.paperConfigLandscape
      : LEGACY_KEYS.paperConfigPortrait;

  localStorage.setItem(key, JSON.stringify(config));
  if (key !== legacyKey) {
    localStorage.setItem(legacyKey, JSON.stringify(config));
  }
};

export const getPaperSize = (
  orientation: PrintOrientation,
): PaperSizeOption | null => {
  const activeKey =
    orientation === "landscape"
      ? PRINT_STORAGE_KEYS.paperSizeLandscape
      : PRINT_STORAGE_KEYS.paperSizePortrait;
  const legacyKey =
    orientation === "landscape"
      ? LEGACY_KEYS.paperSizeLandscape
      : LEGACY_KEYS.paperSizePortrait;

  const value = readStorageWithFallback(activeKey, legacyKey);
  if (!value) return null;
  return value as PaperSizeOption;
};

export const setPaperSize = (
  orientation: PrintOrientation,
  value: PaperSizeOption,
): void => {
  const key =
    orientation === "landscape"
      ? PRINT_STORAGE_KEYS.paperSizeLandscape
      : PRINT_STORAGE_KEYS.paperSizePortrait;

  const legacyKey =
    orientation === "landscape"
      ? LEGACY_KEYS.paperSizeLandscape
      : LEGACY_KEYS.paperSizePortrait;

  localStorage.setItem(key, value);
  if (key !== legacyKey) {
    localStorage.setItem(legacyKey, value);
  }
};

export const getPaperTypeByOrientation = (
  orientation: PrintOrientation,
): PaperType => {
  if (!ENABLE_OFFICE_PAPER_MENU) {
    // ซ่อน "เมนู" เลือกกระดาษ ≠ ตู้นี้ใช้กระดาษรูป
    // ต้องคืนกระดาษตาม profile ที่ตู้ใช้จริง (customer_a4 → "a4")
    // ไม่งั้นฝั่ง Rust จะไปเข้า legacy branch แล้วสั่ง media 4x6 ลงบนแผ่น A4
    // → รูปออกมาเล็กอยู่ส่วนเดียวของแผ่น ที่เหลือว่างเปล่า
    return ACTIVE_PAPER_TYPE;
  }

  const selected = getPaperSize(orientation);
  if (selected === "a3") return "a3";
  if (selected === "a4") return "a4";
  return ACTIVE_PAPER_TYPE;
};

export const clearActivePrintConfig = (): void => {
  localStorage.removeItem(PRINT_STORAGE_KEYS.selectedPrinter);
  localStorage.removeItem(PRINT_STORAGE_KEYS.paperConfigPortrait);
  localStorage.removeItem(PRINT_STORAGE_KEYS.paperConfigLandscape);
  localStorage.removeItem(PRINT_STORAGE_KEYS.paperSizePortrait);
  localStorage.removeItem(PRINT_STORAGE_KEYS.paperSizeLandscape);
};

export const clearLegacyPrintConfig = (): void => {
  localStorage.removeItem(LEGACY_KEYS.selectedPrinter);
  localStorage.removeItem(LEGACY_KEYS.paperConfigPortrait);
  localStorage.removeItem(LEGACY_KEYS.paperConfigLandscape);
  localStorage.removeItem(LEGACY_KEYS.paperSizePortrait);
  localStorage.removeItem(LEGACY_KEYS.paperSizeLandscape);
};
