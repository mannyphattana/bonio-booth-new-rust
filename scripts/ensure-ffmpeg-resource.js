/**
 * Patches src-tauri/tauri.conf.json so bundle.resources only includes
 * the FFmpeg path that exists for the current platform (avoids build failure
 * on macOS when win32-x64 path is missing).
 */
import { readFileSync, writeFileSync, accessSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const configPath = join(root, "src-tauri", "tauri.conf.json");

const possibleFfmpeg = [
  { dir: "win32-x64", bin: "ffmpeg.exe", bundle: "ffmpeg.exe" },
  { dir: "win32-ia32", bin: "ffmpeg.exe", bundle: "ffmpeg.exe" },
  { dir: "darwin-arm64", bin: "ffmpeg", bundle: "ffmpeg" },
  { dir: "darwin-x64", bin: "ffmpeg", bundle: "ffmpeg" },
  { dir: "linux-x64", bin: "ffmpeg", bundle: "ffmpeg" },
  { dir: "linux-arm64", bin: "ffmpeg", bundle: "ffmpeg" },
];

const nodeModules = join(root, "node_modules", "@ffmpeg-installer");
let ffmpegEntry = null;
for (const { dir, bin, bundle } of possibleFfmpeg) {
  const full = join(nodeModules, dir, bin);
  try {
    accessSync(full);
    ffmpegEntry = { [`../node_modules/@ffmpeg-installer/${dir}/${bin}`]: bundle };
    break;
  } catch {
    // path doesn't exist, try next
  }
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const resources = { ...config.bundle?.resources };
// Remove any existing ffmpeg resource keys (win32/darwin/linux)
const toRemove = Object.keys(resources).filter((k) =>
  k.includes("@ffmpeg-installer")
);
toRemove.forEach((k) => delete resources[k]);
if (ffmpegEntry) Object.assign(resources, ffmpegEntry);

config.bundle = config.bundle || {};
config.bundle.resources = resources;
writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
