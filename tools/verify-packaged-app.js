const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error('[PACKAGE-VERIFY] ' + message);
  process.exit(1);
}

const sourceRenderer = path.join(process.cwd(), 'src', 'renderer', 'index.html');
if (!fs.existsSync(sourceRenderer)) fail('Source renderer tidak ditemukan: ' + sourceRenderer);

const unpacked = path.join(process.cwd(), 'dist', 'win-unpacked');
const asar = path.join(unpacked, 'resources', 'app.asar');
if (!fs.existsSync(asar)) fail('app.asar tidak ditemukan: ' + asar);

const required = [
  'src/renderer/index.html',
  'src/preload.js'
];

for (const file of required) {
  const packagedPath = path.join(asar, ...file.split('/'));
  if (!fs.existsSync(packagedPath)) {
    fail('File wajib tidak dapat diakses pada lokasi runtime ASAR: ' + packagedPath);
  }
  try {
    fs.accessSync(packagedPath, fs.constants.R_OK);
  } catch (e) {
    fail('File wajib tidak dapat dibaca pada lokasi runtime ASAR: ' + packagedPath);
  }
}

const icon = path.join(process.cwd(), 'build', 'icon.ico');
if (fs.existsSync(icon)) {
  const packagedIcon = path.join(asar, 'build', 'icon.ico');
  if (!fs.existsSync(packagedIcon)) fail('build/icon.ico tidak tersedia di ASAR.');
}

console.log('[PACKAGE-VERIFY] OK');
console.log('[PACKAGE-VERIFY] Renderer, preload, dan asset runtime tersedia pada path yang akan dipakai Electron.');
