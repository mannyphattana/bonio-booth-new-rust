// Build installer สำหรับให้ทีมเทส: ชี้ backend เทส, ไม่ fullscreen, ปิด auto-update, version ต่อท้าย -test
// ไม่แก้ไฟล์ใน repo — ค่าเทสทั้งหมดส่งผ่าน --features / --config ตอน build
//
//   npm run build:test            → version = tag ล่าสุด + "-test" (เช่น 2.5.19-test)
//   npm run build:test -- 2.5.20  → 2.5.20-test
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function latestTagVersion() {
  const r = spawnSync('git', ['tag', '--list', 'v*', '--sort=-v:refname'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const tag = r.stdout.split(/\r?\n/).map((t) => t.trim()).find((t) => /^v\d+\.\d+\.\d+$/.test(t));
  return tag ? tag.slice(1) : null;
}

const base = (process.argv[2] || '').replace(/^v/, '') || latestTagVersion();
if (!base || !/^\d+\.\d+\.\d+$/.test(base)) {
  console.error('❌ หา version ไม่ได้ — ระบุเอง เช่น: npm run build:test -- 2.5.20');
  process.exit(1);
}
const version = `${base}-test`;

console.log(`🧪 Test build ${version} → api-booth-test.boniolabs.com (ไม่ fullscreen, ปิด auto-update)`);

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'),
    'build',
    '--features', 'test-api',
    '--config', path.join(root, 'src-tauri', 'tauri.test.conf.json'),
    '--config', JSON.stringify({ version }),
  ],
  { cwd: root, stdio: 'inherit' },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const nsisDir = path.join(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const installer = fs.readdirSync(nsisDir).find((f) => f.includes(`_${version}_`) && f.endsWith('.exe'));
console.log(`\n✅ ${installer ? path.join(nsisDir, installer) : nsisDir}`);
