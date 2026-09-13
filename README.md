
# ALFASTEC Desktop — Una Digital Solution

Fondasi Electron untuk memindahkan ALFASTEC dari localStorage ke SQLite.

## Fitur fondasi

- Electron desktop
- SQLite (`better-sqlite3`)
- Database di `%APPDATA%\ALFASTEC\database\alfastec.db`
- WAL + foreign keys + busy timeout
- Login administrator dengan `scrypt` + salt unik
- Audit log login dan perubahan password
- Context Isolation
- Node Integration OFF
- Sandbox ON
- IPC API whitelist melalui preload
- External WhatsApp hanya melalui main process
- Backup dan integrity check database
- Copyright Una Digital Solution + tombol WhatsApp

## Instalasi

```bash
npm install
npm start
```

## Build EXE

```bash
npm run build
```

Hasil ada di folder `dist/`.

## Catatan penting

Ini adalah fondasi migrasi, bukan klaim bahwa seluruh modul HTML sudah sepenuhnya bermigrasi ke SQLite.
Langkah berikutnya adalah memindahkan CRUD setiap modul dari localStorage ke repository SQLite satu per satu, lalu menjalankan regression test.
