#!/usr/bin/env node
/**
 * ALFASTEC — Pemulihan Akun (dipakai HANYA kalau lupa password DAN lupa jawaban keamanan)
 *
 * PENTING:
 *  - Tutup dulu aplikasi ALFASTEC sebelum menjalankan tool ini (supaya file database tidak terkunci).
 *  - Tool ini otomatis membuat backup file database sebelum mengubah apa pun.
 *
 * Cara pakai (di folder project, lewat PowerShell/Command Prompt):
 *   node tools/reset-admin.js
 *
 * Kalau database tidak ditemukan otomatis, jalankan dengan path manual:
 *   node tools/reset-admin.js "C:\Users\NamaUser\AppData\Roaming\alfastec-desktop\database\alfastec.db"
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('\nTidak bisa memuat better-sqlite3. Jalankan dulu "npm install" di folder project ini, lalu coba lagi.\n');
  process.exit(1);
}

function findDefaultDbPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, 'alfastec-desktop', 'database', 'alfastec.db'), // nama dari package.json "name"
    path.join(appData, 'ALFASTEC', 'database', 'alfastec.db')          // nama dari productName
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function hashPassword(password, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

function normalizeAnswer(answer) {
  return String(answer || '').trim().toLowerCase();
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}
function askHidden(rl, question) {
  // Password disamarkan sederhana di terminal (tetap tersimpan sebagai teks biasa di layar riwayat
  // command prompt Windows secara umum; pastikan tidak ada orang lain melihat layar saat mengetik).
  return ask(rl, question);
}

async function main() {
  console.log('=== ALFASTEC — Pemulihan Akun ===\n');
  console.log('PERINGATAN: Pastikan aplikasi ALFASTEC sudah DITUTUP sebelum lanjut.\n');

  const argPath = process.argv[2];
  const dbPath = argPath || findDefaultDbPath();

  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error('Database tidak ditemukan secara otomatis.');
    console.error('Cari file "alfastec.db" (biasanya di %APPDATA%\\alfastec-desktop\\database\\ atau %APPDATA%\\ALFASTEC\\database\\),');
    console.error('lalu jalankan ulang: node tools/reset-admin.js "path\\ke\\alfastec.db"');
    process.exit(1);
  }

  console.log('Database ditemukan di:\n  ' + dbPath + '\n');

  // Backup dulu sebelum menyentuh apa pun
  const backupPath = dbPath + '.backup-' + Date.now() + '.db';
  fs.copyFileSync(dbPath, backupPath);
  console.log('Backup otomatis dibuat di:\n  ' + backupPath + '\n');

  const db = new Database(dbPath);
  const users = db.prepare('SELECT id, username, role, active FROM users').all();

  if (users.length === 0) {
    console.log('Tidak ada akun tersimpan di database ini. Buka aplikasinya — akan otomatis muncul layar "Buat Administrator".');
    db.close();
    return;
  }

  console.log('Akun yang ada saat ini:');
  users.forEach(u => console.log(`  - ${u.username} (role: ${u.role}, aktif: ${u.active ? 'ya' : 'tidak'})`));
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Pilih tindakan:');
  console.log('  1) Reset password salah satu akun di atas (akun & data lain tidak berubah)');
  console.log('  2) Hapus SEMUA akun (aplikasi akan minta dibuatkan admin baru dari nol)');
  const choice = (await ask(rl, '\nMasukkan pilihan (1/2): ')).trim();

  if (choice === '1') {
    const username = (await ask(rl, 'Username yang mau direset: ')).trim();
    const u = users.find(x => x.username === username);
    if (!u) {
      console.log('Username tidak ditemukan. Tidak ada perubahan dilakukan.');
      rl.close(); db.close(); return;
    }
    let newPass = '';
    while (newPass.length < 10) {
      newPass = await askHidden(rl, 'Password baru (minimal 10 karakter): ');
      if (newPass.length < 10) console.log('Terlalu pendek, coba lagi.');
    }
    const confirmPass = await askHidden(rl, 'Ulangi password baru: ');
    if (confirmPass !== newPass) {
      console.log('Konfirmasi tidak sama. Tidak ada perubahan dilakukan.');
      rl.close(); db.close(); return;
    }

    const setSec = (await ask(rl, 'Sekalian atur ulang pertanyaan keamanan? (y/n): ')).trim().toLowerCase();
    const p = hashPassword(newPass);
    if (setSec === 'y') {
      const q = await ask(rl, 'Pertanyaan keamanan baru: ');
      const a = await ask(rl, 'Jawaban keamanan baru: ');
      const ah = hashPassword(normalizeAnswer(a));
      db.prepare('UPDATE users SET password_hash=?, salt=?, security_question=?, security_answer_hash=?, security_answer_salt=? WHERE id=?')
        .run(p.hash, p.salt, q.trim(), ah.hash, ah.salt, u.id);
    } else {
      db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(p.hash, p.salt, u.id);
    }
    db.prepare(`INSERT INTO audit_logs(user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)`)
      .run(u.id, 'PASSWORD_RESET', 'user', String(u.id), 'Password direset manual lewat tools/reset-admin.js');

    console.log(`\nSelesai. Password untuk "${username}" sudah diganti. Silakan buka aplikasi dan login dengan password baru.`);
  } else if (choice === '2') {
    const confirm = (await ask(rl, '\nYAKIN hapus SEMUA akun? Ketik "HAPUS" untuk melanjutkan: ')).trim();
    if (confirm !== 'HAPUS') {
      console.log('Dibatalkan. Tidak ada perubahan dilakukan.');
      rl.close(); db.close(); return;
    }
    db.prepare('DELETE FROM users').run();
    console.log('\nSelesai. Semua akun dihapus. Buka aplikasi — akan muncul layar "Buat Administrator" untuk mulai dari nol.');
  } else {
    console.log('Pilihan tidak dikenali. Tidak ada perubahan dilakukan.');
  }

  rl.close();
  db.close();
}

main().catch(err => {
  console.error('\nTerjadi kesalahan:', err.message);
  console.error('Database asli tidak diubah kalau kesalahan terjadi sebelum proses update selesai — cek juga file backup yang sudah dibuat di atas.');
  process.exit(1);
});
