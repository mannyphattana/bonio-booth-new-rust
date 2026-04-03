import { invoke } from "@tauri-apps/api/core";

export type PrintProfile = "legacy_4x6" | "customer_a4";
export type PaperType = "photo_4x6" | "a4" | "a3";
export type PaperSizeOption = "2x6" | "4x6" | "6x2" | "6x4" | "a4" | "a3";

// Temporary rollout switch: hide office-paper menu (A4/A3) until customer enables it.
export const ENABLE_OFFICE_PAPER_MENU = false;

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

interface PersistedPrintProfile {
  selectedPrinter: string;
  paperConfigPortrait: PaperConfig;
  paperConfigLandscape: PaperConfig;
  paperSizePortrait: string;
  paperSizeLandscape: string;
}

export const PRINT_STORAGE_KEYS = {
  selectedPrinter: `${PROFILE_PREFIX}selectedPrinter`,
  paperConfigPortrait: `${PROFILE_PREFIX}paperConfigPortrait`,
  paperConfigLandscape: `${PROFILE_PREFIX}paperConfigLandscape`,
  paperSizePortrait: `${PROFILE_PREFIX}paperSizePortrait`,
  paperSizeLandscape: `${PROFILE_PREFIX}paperSizeLandscape`,
} as const;

const persistPrintProfileToDisk = (): void => {
  const payload: PersistedPrintProfile = {
    selectedPrinter: getSelectedPrinter(),
    paperConfigPortrait: getPaperConfig("portrait") || { scale: 100, vertical: 0, horizontal: 0 },
    paperConfigLandscape: getPaperConfig("landscape") || { scale: 100, vertical: 0, horizontal: 0 },
    paperSizePortrait: getPaperSize("portrait") || "",
    paperSizeLandscape: getPaperSize("landscape") || "",
  };

  invoke("save_print_profile", { profile: payload }).catch(() => {
    // Keep UX non-blocking if disk persistence fails; localStorage still works as fallback.
  });
};

const writeStorageWithLegacy = (activeKey: string, legacyKey: string, value: string): void => {
  localStorage.setItem(activeKey, value);
  if (activeKey !== legacyKey) {
    localStorage.setItem(legacyKey, value);
  }
};

// Keep legacy 4x6 as base behavior. A4/A3 are explicit choices only.
export const ACTIVE_PAPER_TYPE: PaperType = "photo_4x6";

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
  writeStorageWithLegacy(
    PRINT_STORAGE_KEYS.selectedPrinter,
    LEGACY_KEYS.selectedPrinter,
    printerName,
  );
  persistPrintProfileToDisk();
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

  writeStorageWithLegacy(key, legacyKey, JSON.stringify(config));
  persistPrintProfileToDisk();
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

  writeStorageWithLegacy(key, legacyKey, value);
  persistPrintProfileToDisk();
};

export const getPaperTypeByOrientation = (
  orientation: PrintOrientation,
): PaperType => {
  if (!ENABLE_OFFICE_PAPER_MENU) {
    return "photo_4x6";
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
  persistPrintProfileToDisk();
};

export const clearLegacyPrintConfig = (): void => {
  localStorage.removeItem(LEGACY_KEYS.selectedPrinter);
  localStorage.removeItem(LEGACY_KEYS.paperConfigPortrait);
  localStorage.removeItem(LEGACY_KEYS.paperConfigLandscape);
  localStorage.removeItem(LEGACY_KEYS.paperSizePortrait);
  localStorage.removeItem(LEGACY_KEYS.paperSizeLandscape);
  persistPrintProfileToDisk();
};

export const hydratePrintProfileFromDisk = async (): Promise<void> => {
  try {
    const profile = await invoke<PersistedPrintProfile>("load_print_profile");

    if (profile.selectedPrinter) {
      writeStorageWithLegacy(
        PRINT_STORAGE_KEYS.selectedPrinter,
        LEGACY_KEYS.selectedPrinter,
        profile.selectedPrinter,
      );
    }

    if (profile.paperConfigPortrait) {
      writeStorageWithLegacy(
        PRINT_STORAGE_KEYS.paperConfigPortrait,
        LEGACY_KEYS.paperConfigPortrait,
        JSON.stringify(profile.paperConfigPortrait),
      );
    }

    if (profile.paperConfigLandscape) {
      writeStorageWithLegacy(
        PRINT_STORAGE_KEYS.paperConfigLandscape,
        LEGACY_KEYS.paperConfigLandscape,
        JSON.stringify(profile.paperConfigLandscape),
      );
    }

    if (profile.paperSizePortrait) {
      writeStorageWithLegacy(
        PRINT_STORAGE_KEYS.paperSizePortrait,
        LEGACY_KEYS.paperSizePortrait,
        profile.paperSizePortrait,
      );
    }

    if (profile.paperSizeLandscape) {
      writeStorageWithLegacy(
        PRINT_STORAGE_KEYS.paperSizeLandscape,
        LEGACY_KEYS.paperSizeLandscape,
        profile.paperSizeLandscape,
      );
    }
  } catch {
    // First run or corrupted file: ignore and keep existing localStorage behavior.
  }
};
