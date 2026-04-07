import { load } from "@tauri-apps/plugin-store";

const STORE_FILE = "paper-config.json";

export interface PaperConfig {
  scale: number;
  vertical: number;
  horizontal: number;
}

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  scale: 100,
  vertical: 0,
  horizontal: 0,
};

export async function loadPaperConfigs(): Promise<{
  portrait: PaperConfig;
  landscape: PaperConfig;
  portraitSize: "2x6" | "4x6";
  landscapeSize: "6x2" | "6x4";
}> {
  const store = await load(STORE_FILE);
  const portrait =
    (await store.get<PaperConfig>("paperConfigPortrait")) ??
    { ...DEFAULT_PAPER_CONFIG };
  const landscape =
    (await store.get<PaperConfig>("paperConfigLandscape")) ??
    { ...DEFAULT_PAPER_CONFIG };
  const portraitSize =
    (await store.get<"2x6" | "4x6">("paperSizePortrait")) ?? "4x6";
  const landscapeSize =
    (await store.get<"6x2" | "6x4">("paperSizeLandscape")) ?? "6x4";
  return { portrait, landscape, portraitSize, landscapeSize };
}

export async function savePaperConfigs(
  portraitConfig: PaperConfig,
  landscapeConfig: PaperConfig,
  portraitSize: string,
  landscapeSize: string,
): Promise<void> {
  const store = await load(STORE_FILE);
  await store.set("paperConfigPortrait", portraitConfig);
  await store.set("paperConfigLandscape", landscapeConfig);
  await store.set("paperSizePortrait", portraitSize);
  await store.set("paperSizeLandscape", landscapeSize);
  await store.save();
}

export async function getPaperConfigForPrint(
  isLandscape: boolean,
): Promise<PaperConfig> {
  const store = await load(STORE_FILE);
  const key = isLandscape ? "paperConfigLandscape" : "paperConfigPortrait";
  return (
    (await store.get<PaperConfig>(key)) ?? { ...DEFAULT_PAPER_CONFIG }
  );
}

export async function clearPaperConfigs(): Promise<void> {
  const store = await load(STORE_FILE);
  await store.delete("paperConfigPortrait");
  await store.delete("paperConfigLandscape");
  await store.delete("paperSizePortrait");
  await store.delete("paperSizeLandscape");
  await store.save();
}
