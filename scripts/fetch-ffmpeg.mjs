// วาง FFmpeg ที่แอปใช้ไว้ที่ src-tauri/ffmpeg/ffmpeg.exe (ไม่อยู่ใน git: 168 MB)
//
// เป็น BtbN build ที่ปักเวอร์ชันไว้ (GPL, static, มีตัวเข้ารหัส H.264 ของ Intel Quick Sync,
// NVIDIA NVENC, AMD AMF — src-tauri/src/encoder.rs เลือกตัวที่เครื่องนั้นใช้ได้) เก็บไว้ที่ release
// "ffmpeg-n8.1.3" ของ repo นี้ (prerelease เหมือน webview2-runtime-* ไม่ให้กลายเป็น latest ที่ตู้ใช้
// เช็คอัปเดต) เพราะลิงก์ดาวน์โหลดของ BtbN หมดอายุ
//
// รัน `npm run fetch:ffmpeg` ครั้งเดียวหลัง clone; workflow release รันให้เองก่อน build ต้องมี `gh`
// ที่ล็อกอินแล้ว (ใน CI ใช้ GITHUB_TOKEN)
//
// เปลี่ยนเวอร์ชัน: โหลด win64-gpl build จาก github.com/BtbN/FFmpeg-Builds, เช็คกับ checksums.sha256
// ของ release นั้น, อัปโหลด bin/ffmpeg.exe ขึ้น release ใหม่ (prerelease, --latest=false)
// แล้วแก้ TAG, ASSET, SHA256 ข้างล่าง

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "ffmpeg-n8.1.3";
const ASSET = "ffmpeg-n8.1.3-win64-gpl.exe";
const SHA256 = "4bce011176e669d2d8412c593d51c549de1fefcf6b62939d45ffe845d7251e49";
const REPO = "mannyphattana/bonio-booth-new-rust";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "ffmpeg");
const target = join(dir, "ffmpeg.exe");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

if (existsSync(target) && sha256(target) === SHA256) {
  console.log(`ffmpeg: ${target} is already ${ASSET}`);
  process.exit(0);
}

mkdirSync(dir, { recursive: true });
const downloaded = join(dir, ASSET);
rmSync(downloaded, { force: true });
console.log(`ffmpeg: downloading ${ASSET} from release ${TAG} of ${REPO}`);
execFileSync("gh", ["release", "download", TAG, "--repo", REPO, "--pattern", ASSET, "--dir", dir], { stdio: "inherit" });

const got = sha256(downloaded);
if (got !== SHA256) {
  rmSync(downloaded, { force: true });
  console.error(`ffmpeg: ${ASSET} has sha256 ${got}, expected ${SHA256}`);
  process.exit(1);
}
rmSync(target, { force: true });
renameSync(downloaded, target);
console.log(`ffmpeg: ${target} ready`);
