const { spawn } = require('child_process');
const path = require('path');

const isWindows = process.platform === 'win32';
const exeName = isWindows ? 'bonio-booth.exe' : 'bonio-booth';
const exePath = path.join(__dirname, '..', 'src-tauri', 'target', 'release', exeName);

const child = spawn(exePath, [], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
});

child.on('error', (err) => {
  console.error('Failed to start app:', err.message);
  console.error('Make sure you have run: npm run build:only');
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
