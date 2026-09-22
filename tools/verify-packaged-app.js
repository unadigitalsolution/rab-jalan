const fs = require('fs');
const path = require('path');
const { listPackage } = require('@electron/asar');

function fail(message) {
  console.error('[PACKAGE-VERIFY] ' + message);
  process.exit(1);
}

const sourceRenderer = path.join(process.cwd(), 'src', 'renderer', 'index.html');
if (!fs.existsSync(sourceRenderer)) fail('Source renderer tidak ditemukan: ' + sourceRenderer);

const unpacked = path.join(process.cwd(), 'dist', 'win-unpacked');
const asar = path.join(unpacked, 'resources', 'app.asar');
if (!fs.existsSync(asar)) fail('app.asar tidak ditemukan: ' + asar);

let entries;
try {
  entries = listPackage(asar).map(p => String(p).replace(/^\/+/, ''));
} catch (e) {
  fail('Tidak dapat membaca app.asar: ' + e.message);
}

const required = [
  'src/main.js',
  'src/preload.js',
  'src/renderer/index.html'
];

for (const file of required) {
  if (!entries.includes(file)) {
    fail('File wajib tidak masuk ke app.asar: ' + file);
  }
}

const icon = path.join(process.cwd(), 'build', 'icon.ico');
if (fs.existsSync(icon) && !entries.includes('build/icon.ico')) {
  fail('build/icon.ico tersedia di source tetapi tidak masuk ke app.asar.');
}

console.log('[PACKAGE-VERIFY] OK');
console.log('[PACKAGE-VERIFY] app.asar berisi renderer utama, main, preload, dan asset yang diperlukan.');
