
const { app, BrowserWindow, ipcMain, shell, session, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const Database = require('better-sqlite3');

const APP_NAME = 'ALFASTEC';

let DB_DIR;
let DB_FILE;
let BACKUP_DIR;
let db;
let mainWindow;

// Production hardening: one running instance and strict IPC origin checks.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function assertTrustedSender(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  if (!url.startsWith('file://')) throw new Error('Akses IPC ditolak.');
}

function registerSecurityGuards() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (details, callback) => {
    const u = details.url || '';
    // The app is local-only. Network access is permitted only through explicit shell.openExternal paths.
    callback({ cancel: !u.startsWith('file://') });
  });
}

function ensureDirs() {
  const userData = app.getPath('userData');
  DB_DIR = path.join(userData, 'database');
  DB_FILE = path.join(DB_DIR, 'alfastec.db');
  BACKUP_DIR = path.join(userData, 'backups');
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function openDatabase() {
  ensureDirs();
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      owner TEXT,
      location TEXT,
      start_date TEXT,
      end_date TEXT,
      value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      position TEXT,
      phone TEXT,
      email TEXT,
      salary REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      unit TEXT,
      category TEXT,
      price REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS labor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      unit TEXT,
      wage REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,
      name TEXT NOT NULL,
      unit TEXT,
      rate REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ahsp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      unit TEXT,
      category TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ahsp_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ahsp_id INTEGER NOT NULL,
      component_type TEXT NOT NULL CHECK(component_type IN ('material','labor','equipment')),
      component_id INTEGER NOT NULL,
      coefficient REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(ahsp_id) REFERENCES ahsp(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS boq (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      code TEXT,
      name TEXT NOT NULL,
      unit TEXT,
      volume REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      ahsp_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY(ahsp_id) REFERENCES ahsp(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      number TEXT NOT NULL UNIQUE,
      customer TEXT,
      description TEXT,
      qty REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft',
      date TEXT,
      due_date TEXT,
      note TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      number TEXT NOT NULL UNIQUE,
      date TEXT,
      received_from TEXT NOT NULL,
      address TEXT,
      amount REAL NOT NULL DEFAULT 0,
      purpose TEXT NOT NULL,
      method TEXT,
      status TEXT,
      note TEXT,
      receiver TEXT,
      receiver_role TEXT,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      period TEXT NOT NULL,
      basic REAL NOT NULL DEFAULT 0,
      allowance REAL NOT NULL DEFAULT 0,
      bonus REAL NOT NULL DEFAULT 0,
      overtime REAL NOT NULL DEFAULT 0,
      deduction REAL NOT NULL DEFAULT 0,
      method TEXT,
      status TEXT,
      date TEXT,
      note TEXT,
      FOREIGN KEY(employee_id) REFERENCES employees(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('IN','OUT','ADJUST')),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(material_id) REFERENCES materials(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      device_label TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_boq_project ON boq(project_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll(employee_id);
    CREATE INDEX IF NOT EXISTS idx_stock_material ON stock_transactions(material_id);
    CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);
  `);

  // --- Master-data relational mirror columns (migrasi bertahap dari kv_store) ---
  // client_uid menyimpan id string yang dipakai renderer (mis. "EMP_xxx"),
  // dipakai sebagai kunci upsert agar id INTEGER internal tabel tidak berubah-ubah.
  const ensureColumn = (table, colDef) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch (e) { /* kolom sudah ada */ }
  };
  ensureColumn('users', 'security_question TEXT');
  ensureColumn('users', 'security_answer_hash TEXT');
  ensureColumn('users', 'security_answer_salt TEXT');

  ensureColumn('employees', 'client_uid TEXT');
  ensureColumn('employees', 'division TEXT');
  ensureColumn('employees', 'status TEXT');
  ensureColumn('employees', 'join_date TEXT');
  ensureColumn('employees', 'skill TEXT');
  ensureColumn('employees', 'note TEXT');

  ensureColumn('materials', 'client_uid TEXT');
  ensureColumn('materials', 'supplier TEXT');
  ensureColumn('materials', 'note TEXT');

  ensureColumn('labor', 'client_uid TEXT');
  ensureColumn('labor', 'category TEXT');
  ensureColumn('labor', 'status TEXT');
  ensureColumn('labor', 'note TEXT');

  ensureColumn('equipment', 'client_uid TEXT');
  ensureColumn('equipment', 'category TEXT');
  ensureColumn('equipment', 'status TEXT');
  ensureColumn('equipment', 'note TEXT');

  ensureColumn('ahsp', 'client_uid TEXT');

  ensureColumn('invoices', 'client_uid TEXT');
  ensureColumn('invoices', 'phone TEXT');
  ensureColumn('invoices', 'email TEXT');
  ensureColumn('invoices', 'address TEXT');

  ensureColumn('receipts', 'client_uid TEXT');

  ensureColumn('payroll', 'client_uid TEXT');

  ensureColumn('stock_transactions', 'client_uid TEXT');

  ensureColumn('boq', 'client_uid TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_client_uid ON employees(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_client_uid ON materials(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_labor_client_uid ON labor(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_client_uid ON equipment(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ahsp_client_uid ON ahsp(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_client_uid ON invoices(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_client_uid ON receipts(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_client_uid ON payroll(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stocktx_client_uid ON stock_transactions(client_uid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_boq_client_uid ON boq(client_uid);
  `);
}

// Sinkronkan array (dari localStorage/kv_store) ke tabel relasional.
// Upsert berdasarkan client_uid; baris yang sudah tidak ada di array akan dihapus
// (kecuali sedang dipakai relasi lain -> RESTRICT akan menahan penghapusan itu).
function syncMasterTable(table, columns, rows) {
  if (!Array.isArray(rows)) throw new Error('Data sinkronisasi tidak valid.');
  const cols = ['client_uid', ...columns.map(c => c.col)];
  const placeholders = cols.map(() => '?').join(',');
  const updateSet = columns.map(c => `${c.col}=excluded.${c.col}`).join(',');
  const upsert = db.prepare(`
    INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
    ON CONFLICT(client_uid) DO UPDATE SET ${updateSet}
  `);
  const uids = [];
  const skipped = [];
  const tx = db.transaction((items) => {
    for (const r of items) {
      const clientUid = String(r?.id || '').trim();
      if (!clientUid) continue;
      try {
        const values = columns.map(c => c.map(r));
        if (values.some(v => v === '__SKIP_ROW__')) { skipped.push(clientUid); continue; }
        upsert.run(clientUid, ...values);
        uids.push(clientUid);
      } catch (e) {
        // Baris tidak valid (mis. duplikat kode/nomor, referensi rusak) - lewati, jangan gagalkan seluruh sinkronisasi.
        skipped.push(clientUid);
      }
    }
    if (uids.length) {
      const ph = uids.map(() => '?').join(',');
      db.prepare(`DELETE FROM ${table} WHERE client_uid IS NOT NULL AND client_uid NOT IN (${ph})`).run(...uids);
    } else {
      db.prepare(`DELETE FROM ${table} WHERE client_uid IS NOT NULL`).run();
    }
  });
  tx(rows);
  return { synced: uids.length, skipped: skipped.length };
}

const MASTER_SYNC_DEFS = {
  employees: [
    { col: 'code', map: r => r.nik || null },
    { col: 'name', map: r => r.name || '' },
    { col: 'position', map: r => r.position || null },
    { col: 'phone', map: r => r.phone || null },
    { col: 'email', map: r => r.email || null },
    { col: 'division', map: r => r.division || null },
    { col: 'status', map: r => r.status || null },
    { col: 'join_date', map: r => r.join || null },
    { col: 'skill', map: r => r.skill || null },
    { col: 'note', map: r => r.note || null }
  ],
  materials: [
    { col: 'code', map: r => r.code || null },
    { col: 'name', map: r => r.name || '' },
    { col: 'unit', map: r => r.unit || null },
    { col: 'category', map: r => r.category || null },
    { col: 'price', map: r => Number(r.price) || 0 },
    { col: 'stock', map: r => Number(r.stock) || 0 },
    { col: 'min_stock', map: r => Number(r.min) || 0 },
    { col: 'supplier', map: r => r.supplier || null },
    { col: 'note', map: r => r.note || null }
  ],
  labor: [
    { col: 'code', map: r => r.code || null },
    { col: 'name', map: r => r.name || '' },
    { col: 'unit', map: r => r.unit || null },
    { col: 'wage', map: r => Number(r.price) || 0 },
    { col: 'category', map: r => r.category || null },
    { col: 'status', map: r => r.status || null },
    { col: 'note', map: r => r.note || null }
  ],
  equipment: [
    { col: 'code', map: r => r.code || null },
    { col: 'name', map: r => r.name || '' },
    { col: 'unit', map: r => r.unit || null },
    { col: 'rate', map: r => Number(r.price) || 0 },
    { col: 'category', map: r => r.category || null },
    { col: 'status', map: r => r.status || null },
    { col: 'note', map: r => r.note || null }
  ],
  ahsp: [
    { col: 'code', map: r => r.code || '' },
    { col: 'name', map: r => r.name || '' },
    { col: 'unit', map: r => r.unit || null },
    { col: 'category', map: r => r.category || null }
  ],
  invoices: [
    { col: 'number', map: r => r.number || null },
    { col: 'customer', map: r => r.customer || null },
    { col: 'phone', map: r => r.phone || null },
    { col: 'email', map: r => r.email || null },
    { col: 'address', map: r => r.address || null },
    { col: 'description', map: r => r.description || null },
    { col: 'qty', map: r => Number(r.qty) || 0 },
    { col: 'price', map: r => Number(r.price) || 0 },
    { col: 'discount', map: r => Number(r.discount) || 0 },
    { col: 'tax', map: r => Number(r.tax) || 0 },
    { col: 'status', map: r => r.status || null },
    { col: 'date', map: r => r.date || null },
    { col: 'due_date', map: r => r.due || null },
    { col: 'note', map: r => r.note || null }
  ],
  receipts: [
    { col: 'number', map: r => r.number || null },
    { col: 'date', map: r => r.date || null },
    { col: 'received_from', map: r => r.from || '' },
    { col: 'address', map: r => r.address || null },
    { col: 'amount', map: r => Number(r.amount) || 0 },
    { col: 'purpose', map: r => r.purpose || '' },
    { col: 'method', map: r => r.method || null },
    { col: 'status', map: r => r.status || null },
    { col: 'note', map: r => r.note || null },
    { col: 'receiver', map: r => r.receiver || null },
    { col: 'receiver_role', map: r => r.receiverRole || null }
  ],
  payroll: [
    {
      col: 'employee_id',
      map: r => {
        const e = db.prepare('SELECT id FROM employees WHERE client_uid = ?').get(String(r.employeeId || ''));
        return e ? e.id : '__SKIP_ROW__';
      }
    },
    { col: 'period', map: r => r.period || '' },
    { col: 'basic', map: r => Number(r.basic) || 0 },
    { col: 'allowance', map: r => Number(r.allowance) || 0 },
    { col: 'bonus', map: r => Number(r.bonus) || 0 },
    { col: 'overtime', map: r => Number(r.overtime) || 0 },
    { col: 'deduction', map: r => Number(r.deduction) || 0 },
    { col: 'method', map: r => r.method || null },
    { col: 'status', map: r => r.status || null },
    { col: 'date', map: r => r.date || null },
    { col: 'note', map: r => r.note || null }
  ],
  stock_transactions: [
    {
      col: 'material_id',
      map: r => {
        const m = db.prepare('SELECT id FROM materials WHERE client_uid = ?').get(String(r.materialId || ''));
        return m ? m.id : '__SKIP_ROW__';
      }
    },
    { col: 'type', map: r => (String(r.type || '').toLowerCase() === 'in' ? 'IN' : String(r.type || '').toLowerCase() === 'out' ? 'OUT' : 'ADJUST') },
    { col: 'quantity', map: r => Number(r.qty) || 0 },
    { col: 'unit_price', map: r => Number(r.unitPrice) || 0 },
    { col: 'note', map: r => r.date ? ('Tanggal (aplikasi): ' + r.date) : null }
  ],
  boq: [
    {
      col: 'project_id',
      map: r => {
        const p = db.prepare('SELECT id FROM projects WHERE code = ?').get(String(r.projectCode || ''));
        return p ? p.id : '__SKIP_ROW__';
      }
    },
    { col: 'code', map: r => r.code || null },
    { col: 'name', map: r => r.name || '' },
    { col: 'unit', map: r => r.unit || null },
    { col: 'volume', map: r => Number(r.volume) || 0 },
    { col: 'price', map: r => Number(r.price) || 0 },
    {
      col: 'ahsp_id',
      map: r => {
        if (!r.ahspId) return null;
        const a = db.prepare('SELECT id FROM ahsp WHERE client_uid = ?').get(String(r.ahspId));
        return a ? a.id : null;
      }
    }
  ]
};

function hashPassword(password, saltHex) {
  const crypto = require('crypto');
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { hash: hash.toString('hex'), salt: salt.toString('hex') };
}

function verifyPassword(password, hashHex, saltHex) {
  const crypto = require('crypto');
  const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(derived, Buffer.from(hashHex, 'hex'));
}

function audit(userId, action, entity, entityId, details) {
  db.prepare(`
    INSERT INTO audit_logs(user_id, action, entity, entity_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId || null, action, entity || null, entityId || null, details || null);
}

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username.trim());
  if (!u || !verifyPassword(password, u.password_hash, u.salt)) {
    throw new Error('Username atau password salah.');
  }
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(u.id);
  audit(u.id, 'LOGIN', 'user', String(u.id), 'Login berhasil');
  return { id: u.id, username: u.username, role: u.role };
}

function createInitialAdmin(username, password, securityQuestion, securityAnswer) {
  if (userCount() > 0) throw new Error('Akun administrator sudah tersedia.');
  if (!username || username.length < 3) throw new Error('Username minimal 3 karakter.');
  if (!password || password.length < 10) throw new Error('Password minimal 10 karakter.');
  if (!securityQuestion || securityQuestion.trim().length < 5) throw new Error('Pertanyaan keamanan wajib diisi (minimal 5 karakter).');
  if (!securityAnswer || securityAnswer.trim().length < 2) throw new Error('Jawaban keamanan wajib diisi.');
  const p = hashPassword(password);
  const a = hashPassword(normalizeAnswer(securityAnswer));
  const info = db.prepare(`
    INSERT INTO users(username,password_hash,salt,role,security_question,security_answer_hash,security_answer_salt)
    VALUES(?,?,?,'admin',?,?,?)
  `).run(username.trim(), p.hash, p.salt, securityQuestion.trim(), a.hash, a.salt);
  audit(info.lastInsertRowid, 'CREATE', 'user', String(info.lastInsertRowid), 'Administrator pertama dibuat');
  return { id: info.lastInsertRowid, username: username.trim(), role: 'admin' };
}

function normalizeAnswer(answer) {
  return String(answer || '').trim().toLowerCase();
}

function getSecurityQuestion(username) {
  const u = db.prepare('SELECT security_question FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!u || !u.security_question) throw new Error('Akun tidak ditemukan atau belum mengatur pertanyaan keamanan. Hubungi administrator lain.');
  return u.security_question;
}

function resetPasswordWithSecurityAnswer(username, answer, newPassword) {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || '').trim());
  if (!u || !u.security_answer_hash) throw new Error('Akun tidak ditemukan atau belum mengatur pertanyaan keamanan.');
  if (!verifyPassword(normalizeAnswer(answer), u.security_answer_hash, u.security_answer_salt)) {
    throw new Error('Jawaban keamanan salah.');
  }
  if (!newPassword || newPassword.length < 10) throw new Error('Password baru minimal 10 karakter.');
  const p = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(p.hash, p.salt, u.id);
  audit(u.id, 'PASSWORD_RESET', 'user', String(u.id), 'Password direset via pertanyaan keamanan');
  return true;
}

function changePassword(userId, oldPassword, newPassword) {
  const u = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(userId);
  if (!u || !verifyPassword(oldPassword, u.password_hash, u.salt)) {
    throw new Error('Password lama salah.');
  }
  if (!newPassword || newPassword.length < 10) throw new Error('Password baru minimal 10 karakter.');
  const p = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(p.hash, p.salt, userId);
  audit(userId, 'PASSWORD_CHANGE', 'user', String(userId), 'Password diubah');
  return true;
}

function backupDatabase() {
  db.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `ALFASTEC_Backup_${stamp}.db`);
  db.backup(target);
  return target;
}

function integrityCheck() {
  return db.pragma('integrity_check', { simple: true });
}

/* ======================================================================
   TAHAP 1 — SERVER SINKRONISASI LAN (untuk companion app Android)
   Tidak pakai cloud sama sekali: server ini cuma nyala di jaringan lokal
   (WiFi yang sama dengan PC). Lingkup Tahap 1 cuma "alur inti": data
   proyek (tabel projects) dan draft Proyek/Data Jalan/RAB-BOQ (kv_store
   key 'alfastec_project_draft' & 'alfast_boq') — modul lain menyusul.
   ====================================================================== */
const LAN_SYNC_PORT = 8787;
const LAN_SYNC_KV_WHITELIST = ['alfastec_project_draft', 'alfast_boq'];
const LAN_TOKEN_TTL_DAYS = 30;
let lanServer = null;
let lanServerActualPort = null;

function isLanSyncEnabled() {
  const v = db.prepare("SELECT value FROM app_meta WHERE key='lan_sync_enabled'").get()?.value;
  return v === null || v === undefined ? true : v === '1'; // default ON
}
function setLanSyncEnabled(enabled) {
  db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('lan_sync_enabled',?)").run(enabled ? '1' : '0');
}

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function createApiToken(userId, deviceLabel) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + LAN_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO api_tokens(token, user_id, device_label, expires_at) VALUES (?,?,?,?)`)
    .run(token, userId, deviceLabel || null, expires);
  return { token, expiresAt: expires };
}
function validateApiToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT t.id AS token_id, u.id, u.username, u.role
    FROM api_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > CURRENT_TIMESTAMP AND u.active = 1
  `).get(token);
  if (!row) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.token_id);
  return { id: row.id, username: row.username, role: row.role };
}

// Rate limit sederhana khusus endpoint login (per alamat IP LAN), supaya
// server yang sekarang membuka port jaringan tidak jadi sasaran brute force.
const lanLoginAttempts = new Map(); // ip -> { count, resetAt }
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const rec = lanLoginAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    lanLoginAttempts.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return true;
  }
  if (rec.count >= 8) return false;
  rec.count++;
  return true;
}

function syncPull(since) {
  const sinceStr = since || '1970-01-01T00:00:00.000Z';
  const projects = db.prepare('SELECT * FROM projects WHERE updated_at > ? ORDER BY updated_at ASC').all(sinceStr);
  const kv = {};
  for (const key of LAN_SYNC_KV_WHITELIST) {
    const row = db.prepare('SELECT value, updated_at FROM kv_store WHERE key = ?').get(key);
    if (row && row.updated_at > sinceStr) kv[key] = row;
  }
  return { serverTime: new Date().toISOString(), projects, kv };
}

function syncPush(payload, userId) {
  const results = { projects: { accepted: 0, rejected: 0 }, kv: {} };
  if (Array.isArray(payload?.projects)) {
    for (const p of payload.projects) {
      const code = String(p?.code || '').trim();
      if (!code) { results.projects.rejected++; continue; }
      const incomingTs = p.updated_at || new Date().toISOString();
      const existing = db.prepare('SELECT id, updated_at FROM projects WHERE code = ?').get(code);
      if (existing) {
        if (incomingTs > existing.updated_at) {
          db.prepare(`UPDATE projects SET name=?, owner=?, location=?, start_date=?, end_date=?, value=?, status=?, updated_at=? WHERE id=?`)
            .run(p.name || '', p.owner || null, p.location || null, p.start_date || null, p.end_date || null, Number(p.value) || 0, p.status || 'Draft', incomingTs, existing.id);
          results.projects.accepted++;
        } else {
          results.projects.rejected++; // versi server lebih baru; klien perlu pull
        }
      } else {
        db.prepare(`INSERT INTO projects(code,name,owner,location,start_date,end_date,value,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(code, p.name || '', p.owner || null, p.location || null, p.start_date || null, p.end_date || null, Number(p.value) || 0, p.status || 'Draft', incomingTs);
        results.projects.accepted++;
      }
    }
  }
  if (payload?.kv && typeof payload.kv === 'object') {
    for (const [key, entry] of Object.entries(payload.kv)) {
      if (!LAN_SYNC_KV_WHITELIST.includes(key)) continue;
      if (!entry || typeof entry.value !== 'string') continue;
      const incomingTs = entry.updated_at || new Date().toISOString();
      const existing = db.prepare('SELECT updated_at FROM kv_store WHERE key = ?').get(key);
      if (!existing || incomingTs > existing.updated_at) {
        db.prepare(`INSERT INTO kv_store(key,value,updated_at) VALUES(?,?,?)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(key, entry.value, incomingTs);
        results.kv[key] = 'accepted';
      } else {
        results.kv[key] = 'rejected-server-newer';
      }
    }
  }
  audit(userId, 'LAN_SYNC_PUSH', 'lan-sync', null, JSON.stringify(results));
  return { serverTime: new Date().toISOString(), results };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('Body terlalu besar.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('JSON tidak valid.')); }
    });
    req.on('error', reject);
  });
}

function handleLanRequest(req, res) {
  const url = new URL(req.url, 'http://internal');
  const clientIp = (req.socket.remoteAddress || '').replace('::ffff:', '');

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }); res.end(); return; }

  if (req.method === 'GET' && url.pathname === '/api/status') {
    sendJson(res, 200, { name: APP_NAME, companyName: getBranding().name, version: app.getVersion(), hasAdmin: userCount() > 0, time: new Date().toISOString() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!checkLoginRateLimit(clientIp)) { sendJson(res, 429, { error: 'Terlalu banyak percobaan login. Coba lagi beberapa menit.' }); return; }
    readJsonBody(req).then(({ username, password, deviceLabel }) => {
      try {
        const u = login(String(username || ''), String(password || ''));
        const { token, expiresAt } = createApiToken(u.id, deviceLabel || 'Android');
        audit(u.id, 'LAN_LOGIN', 'user', String(u.id), 'Login dari perangkat LAN: ' + clientIp);
        sendJson(res, 200, { token, expiresAt, user: u });
      } catch (e) { sendJson(res, 401, { error: e.message || 'Login gagal.' }); }
    }).catch((e) => sendJson(res, 400, { error: e.message || 'Permintaan tidak valid.' }));
    return;
  }

  // Endpoint di bawah ini wajib token.
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = validateApiToken(token);
  if (!user) { sendJson(res, 401, { error: 'Token tidak valid atau kedaluwarsa. Silakan login ulang.' }); return; }

  if (req.method === 'GET' && url.pathname === '/api/sync/pull') {
    try { sendJson(res, 200, syncPull(url.searchParams.get('since'))); }
    catch (e) { sendJson(res, 500, { error: e.message || 'Gagal mengambil data.' }); }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/push') {
    readJsonBody(req).then((payload) => {
      try { sendJson(res, 200, syncPush(payload, user.id)); }
      catch (e) { sendJson(res, 500, { error: e.message || 'Gagal menyimpan data.' }); }
    }).catch((e) => sendJson(res, 400, { error: e.message || 'Permintaan tidak valid.' }));
    return;
  }

  sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
}

function startLanServer() {
  if (lanServer) return;
  lanServer = http.createServer((req, res) => {
    try { handleLanRequest(req, res); }
    catch (e) { try { sendJson(res, 500, { error: 'Kesalahan server.' }); } catch (_) {} }
  });
  lanServer.on('error', (e) => { console.error('LAN sync server error:', e.message); lanServer = null; lanServerActualPort = null; });
  lanServer.listen(LAN_SYNC_PORT, '0.0.0.0', () => { lanServerActualPort = LAN_SYNC_PORT; });
}
function stopLanServer() {
  if (!lanServer) return;
  try { lanServer.close(); } catch (_) {}
  lanServer = null;
  lanServerActualPort = null;
}
function getLanSyncInfo() {
  return { enabled: isLanSyncEnabled(), running: !!lanServer, port: lanServerActualPort || LAN_SYNC_PORT, addresses: getLanAddresses() };
}
/* ==================== AKHIR MODUL SERVER SINKRONISASI LAN ==================== */

const LICENSE_API_BASE='https://asia-southeast2-simtrenpro.cloudfunctions.net';
function getStableDeviceId(){const r=db.prepare("SELECT value FROM app_meta WHERE key='device_fingerprint'").get();if(r?.value)return r.value;let g='';if(process.platform==='win32'){try{const{execFileSync}=require('child_process');g=execFileSync('reg',['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).find(x=>/MachineGuid/i.test(x))?.split(/REG_SZ\s+/i)[1]?.trim()||'';}catch(_){}}const id=crypto.createHash('sha256').update([APP_NAME,process.platform,g,os.hostname(),os.userInfo().username].join('|')).digest('hex');db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('device_fingerprint',?)").run(id);return id;}
function httpsJsonPost(url,payload,timeoutMs=12000){return new Promise((resolve,reject)=>{const u=new URL(url),body=JSON.stringify(payload),req=require('https').request({hostname:u.hostname,path:u.pathname+u.search,method:'POST',port:u.port||443,headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:timeoutMs},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{try{const p=JSON.parse(raw||'{}');if(res.statusCode>=200&&res.statusCode<300)resolve(p);else reject(new Error(p.error||p.message||('HTTP '+res.statusCode)));}catch(_){reject(new Error('Respons server tidak valid.'));}})});req.on('timeout',()=>req.destroy(new Error('Koneksi server timeout.')));req.on('error',reject);req.write(body);req.end();});}
async function getTrialStatus(){const deviceId=getStableDeviceId(),v=app.getVersion();try{const x=await httpsJsonPost(LICENSE_API_BASE+'/getAlfastecTrialStatus',{deviceId,appVersion:v});db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('trial_status',?)").run(JSON.stringify(x));return {...x,deviceId,source:'server'};}catch(e){return{success:false,active:false,needsOnline:true,deviceId,error:'Server lisensi trial tidak dapat dihubungi. Hubungkan internet lalu coba lagi.'};}}
async function activateLicense(key,profil){const deviceId=getStableDeviceId(),x=await httpsJsonPost(LICENSE_API_BASE+'/verifyLicense',{licenseKey:String(key||'').trim(),installId:deviceId,profil:profil||null,appVersion:app.getVersion(),role:'server'},15000);if(!x||x.valid!==true||!x.token)throw new Error(x?.message||'Lisensi tidak valid.');db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('license_token',?)").run(x.token);db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('license_key',?)").run(String(key).trim().toUpperCase());db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('license_info',?)").run(JSON.stringify(x));saveBranding({name:profil?.nama||null,logo:profil?.logo||null});return {...x,deviceId};}

const MAX_LOGO_BYTES = 1500000; // ~1.5MB, batas wajar untuk logo di app_meta
function saveBranding({name,logo}){
  if (name && String(name).trim()) {
    db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('company_name',?)").run(String(name).trim());
  }
  if (logo) {
    const str = String(logo);
    if (!/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/.test(str)) throw new Error('Format logo tidak didukung. Gunakan PNG, JPG, WEBP, atau SVG.');
    if (str.length > MAX_LOGO_BYTES) throw new Error('Ukuran logo terlalu besar (maks. ~1.5MB).');
    db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES('company_logo',?)").run(str);
  }
  return getBranding();
}
function getBranding(){
  const name = db.prepare("SELECT value FROM app_meta WHERE key='company_name'").get()?.value || null;
  const logo = db.prepare("SELECT value FROM app_meta WHERE key='company_logo'").get()?.value || null;
  return { name, logo };
}
function createWindow() {
  // Hilangkan menu bawaan Electron (File, Edit, View, Window, Help) — aplikasi
  // ini pakai navigasi sendiri di sidebar, menu bawaan itu tidak dipakai sama
  // sekali dan cuma bikin bingung pengguna non-teknis.
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#f8fafc',
    icon: path.join(__dirname, '../build/icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://wa.me/')) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged && input.type === 'keyDown' && input.control && input.shift && input.key.toUpperCase() === 'I') {
      event.preventDefault();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(() => {
  registerSecurityGuards();
  openDatabase();

  ipcMain.handle('license:trial-status',(event)=>{assertTrustedSender(event);return getTrialStatus();});
  ipcMain.handle('license:activate',async(event,key,profil)=>{assertTrustedSender(event);return activateLicense(key,profil);});
  ipcMain.handle('license:local-status',(event)=>{assertTrustedSender(event);const key=db.prepare("SELECT value FROM app_meta WHERE key='license_key'").get()?.value||null;const token=db.prepare("SELECT value FROM app_meta WHERE key='license_token'").get()?.value||null;return{licensed:!!(key&&token),licenseKey:key};});
  ipcMain.handle('branding:get',(event)=>{assertTrustedSender(event);return getBranding();});
  ipcMain.handle('branding:save',(event,data)=>{assertTrustedSender(event);return saveBranding(data||{});});

  ipcMain.handle('auth:status', (event) => { assertTrustedSender(event); return { hasAdmin: userCount() > 0 }; });
  ipcMain.handle('auth:create-admin', (event, username, password, securityQuestion, securityAnswer) => { assertTrustedSender(event); return createInitialAdmin(username, password, securityQuestion, securityAnswer); });
  ipcMain.handle('auth:login', (event, username, password) => { assertTrustedSender(event); return login(username, password); });
  ipcMain.handle('auth:change-password', (event, userId, oldPassword, newPassword) => { assertTrustedSender(event); return changePassword(userId, oldPassword, newPassword); });
  ipcMain.handle('auth:security-question', (event, username) => { assertTrustedSender(event); return getSecurityQuestion(username); });
  ipcMain.handle('auth:reset-password', (event, username, answer, newPassword) => { assertTrustedSender(event); return resetPasswordWithSecurityAnswer(username, answer, newPassword); });

  ipcMain.handle('db:integrity', (event) => { assertTrustedSender(event); return integrityCheck(); });
  ipcMain.handle('db:backup', (event) => { assertTrustedSender(event); return backupDatabase(); });

  // Sinkronisasi Android via LAN (Tahap 1) — status/toggle dikontrol dari renderer.
  ipcMain.handle('network:lan-info', (event) => { assertTrustedSender(event); return getLanSyncInfo(); });
  ipcMain.handle('network:toggle-sync', (event, enabled) => {
    assertTrustedSender(event);
    setLanSyncEnabled(!!enabled);
    if (enabled) startLanServer(); else stopLanServer();
    return getLanSyncInfo();
  });
  ipcMain.handle('app:open-whatsapp', (event, message) => {
    assertTrustedSender(event);
    const text = encodeURIComponent(message || 'Assalamualaikum mohon bantu untuk solusi ...');
    return shell.openExternal(`https://wa.me/6289646981124?text=${text}`);
  });

  ipcMain.handle('storage:load', (event) => {
    assertTrustedSender(event);
    const rows = db.prepare('SELECT key, value FROM kv_store').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });
  ipcMain.handle('storage:set', (event, key, value) => {
    assertTrustedSender(event);
    if (typeof key !== 'string' || !key || typeof value !== 'string') throw new Error('Data penyimpanan tidak valid.');
    db.prepare(`INSERT INTO kv_store(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(key, value);
    return true;
  });
  ipcMain.handle('storage:remove', (event, key) => {
    assertTrustedSender(event);
    db.prepare('DELETE FROM kv_store WHERE key=?').run(key);
    return true;
  });
  ipcMain.handle('project:save', (event, project) => {
    assertTrustedSender(event);
    if (!project || !project.name) throw new Error('Nama proyek wajib diisi.');
    const code = String(project.code || ('PRJ-' + Date.now())).trim();
    const existing = db.prepare('SELECT id FROM projects WHERE code=?').get(code);
    if (existing) {
      db.prepare(`UPDATE projects SET name=?, owner=?, location=?, start_date=?, end_date=?, value=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(project.name, project.owner||null, project.location||null, project.start_date||null, project.end_date||null, Number(project.value)||0, project.status||'Draft', existing.id);
      return existing.id;
    }
    const info = db.prepare(`INSERT INTO projects(code,name,owner,location,start_date,end_date,value,status) VALUES(?,?,?,?,?,?,?,?)`)
      .run(code, project.name, project.owner||null, project.location||null, project.start_date||null, project.end_date||null, Number(project.value)||0, project.status||'Draft');
    return info.lastInsertRowid;
  });
  ipcMain.handle('projects:list', (event) => {
    assertTrustedSender(event);
    return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC, id DESC').all();
  });
  ipcMain.handle('project:update', (event, id, patch) => {
    assertTrustedSender(event);
    if (!id) throw new Error('ID proyek tidak valid.');
    const existing = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!existing) throw new Error('Proyek tidak ditemukan.');
    const name = (patch && patch.name != null) ? String(patch.name).trim() : existing.name;
    if (!name) throw new Error('Nama proyek wajib diisi.');
    const location = (patch && patch.location != null) ? patch.location : existing.location;
    const status = (patch && patch.status != null) ? patch.status : existing.status;
    const value = (patch && patch.value != null) ? Number(patch.value) || 0 : existing.value;
    db.prepare(`UPDATE projects SET name=?, location=?, status=?, value=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(name, location, status, value, existing.id);
    return true;
  });
  ipcMain.handle('project:delete', (event, id) => {
    assertTrustedSender(event);
    if (!id) throw new Error('ID proyek tidak valid.');
    const existing = db.prepare('SELECT id FROM projects WHERE id=?').get(id);
    if (!existing) throw new Error('Proyek tidak ditemukan.');
    db.prepare('DELETE FROM projects WHERE id=?').run(id);
    return true;
  });

  ipcMain.handle('data:sync-master', (event, table, rows) => {
    assertTrustedSender(event);
    const def = MASTER_SYNC_DEFS[table];
    if (!def) throw new Error('Tabel tidak dikenali: ' + table);
    const result = syncMasterTable(table, def, rows);
    return { table, ...result };
  });

  ipcMain.handle('db:stats', (event) => {
    assertTrustedSender(event);
    return {
    projects: db.prepare('SELECT COUNT(*) n FROM projects').get().n,
    employees: db.prepare('SELECT COUNT(*) n FROM employees').get().n,
    materials: db.prepare('SELECT COUNT(*) n FROM materials').get().n,
    invoices: db.prepare('SELECT COUNT(*) n FROM invoices').get().n,
    receipts: db.prepare('SELECT COUNT(*) n FROM receipts').get().n
    };
  });

  if (isLanSyncEnabled()) startLanServer();

  createWindow();
});

app.on('window-all-closed', () => {
  stopLanServer();
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});
