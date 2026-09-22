const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error('[PACKAGE-VERIFY] ' + message);
  process.exit(1);
}

const sourceRenderer = path.join(process.cwd(), 'src', 'renderer', 'index.html');
if (!fs.existsSync(sourceRenderer)) fail('Source renderer tidak ditemukan: ' + sourceRenderer);

const unpacked = path.join(process.cwd(), 'dist', 'win-unpacked');
const resources = path.join(unpacked, 'resources');
const asar = path.join(resources, 'app.asar');
if (!fs.existsSync(asar)) fail('app.asar tidak ditemukan: ' + asar);

const packagedRenderer = path.join(resources, 'renderer', 'index.html');
if (!fs.existsSync(packagedRenderer)) {
  fail('Renderer hasil build tidak tersedia pada resources/renderer/index.html: ' + packagedRenderer);
}
try {
  fs.accessSync(packagedRenderer, fs.constants.R_OK);
  if (fs.statSync(packagedRenderer).size < 1000) fail('Renderer hasil build terlalu kecil/tidak valid.');
} catch (e) {
  fail('Renderer hasil build tidak dapat dibaca: ' + e.message);
}

const packagedPreload = path.join(asar, 'src', 'preload.js');
if (!fs.existsSync(packagedPreload)) {
  fail('Preload tidak tersedia pada app.asar: ' + packagedPreload);
}

const icon = path.join(process.cwd(), 'build', 'icon.ico');
if (fs.existsSync(icon) && !fs.existsSync(path.join(asar, 'build', 'icon.ico'))) {
  fail('build/icon.ico tersedia di source tetapi tidak masuk ke app.asar.');
}

console.log('[PACKAGE-VERIFY] OK');
console.log('[PACKAGE-VERIFY] Renderer eksternal, preload ASAR, dan asset runtime tersedia.');
