# ALFASTEC Android (Companion App — LAN sync, tanpa cloud)

## Status
- **Tahap 1** (server LAN di exe): selesai & teruji.
- **Tahap 2** (app Android/WebView offline-first): selesai & teruji.
- **Tahap 3** (sync 2 arah, dirty-tracking, last-write-wins): selesai & teruji —
  ternyata sudah harus dibangun bersamaan dengan Tahap 2 supaya app Android-nya
  bisa berfungsi, jadi tidak dipisah lagi.
- **Tahap 4** (build APK release lewat GitHub Actions): **belum dikerjakan.**

## Apa yang SUDAH diuji nyata (bukan cuma dibaca ulang)
Logika inti (`assets/www/index.html`) diuji lewat simulasi Node.js yang
menjalankan server LAN sungguhan (`src/main.js`) dan mengeksekusi kode
JavaScript aplikasi Android apa adanya (tanpa disalin ulang) di dalamnya:
- Login online → dapat token
- Login offline (password benar) saat server sengaja dibuat tidak terjangkau → berhasil
- Login offline (password salah) → ditolak
- Push proyek + draft Data Jalan + BOQ dari "mobile" → diterima server
- Pull balik → data yang sama terlihat, dalam bentuk PERSIS seperti yang
  dibaca desktop (`alfastec_project_draft`, `alfast_boq`)
- Flag "belum sinkron" (dirty) hilang setelah push berhasil

## Apa yang BELUM bisa diuji di sini
Sandbox pengembangan ini **tidak punya Android SDK, Gradle, atau Kotlin
compiler**, dan tidak ada akses jaringan ke Google Maven (`dl.google.com`).
Jadi file `build.gradle`, `AndroidManifest.xml`, dan `MainActivity.kt` ditulis
dengan hati-hati mengikuti struktur proyek Android standar, tapi **belum
pernah benar-benar di-compile**. Kompilasi sungguhan baru akan terverifikasi
saat Tahap 4 (GitHub Actions dengan Android SDK asli). Kalau ada typo kecil
di Gradle/Kotlin, itu akan ketahuan di sana, bukan di sini.

## Cara pairing HP ke PC
1. Buka ALFASTEC di PC → menu **"📱 Sinkron Android"** → pastikan status Aktif.
2. Catat salah satu alamat IP yang tampil (mis. `192.168.1.5`).
3. Buka app Android → masukkan IP tsb + username/password akun exe yang sama.
4. Setelah berhasil sekali secara online, HP bisa login lagi tanpa WiFi yang
   sama (mode offline) — sinkron otomatis lanjut begitu online lagi.

## Lingkup sinkronisasi saat ini
Hanya **Buat Proyek + Data Jalan + RAB/BOQ** (sesuai kesepakatan awal).
Material, Payroll, Invoice, Kwitansi, AHSP/Harga Satuan belum ikut —
BOQ yang dibuat dari HP karena itu tidak punya `ahspId` (harga diisi manual).

## Tahap 4 — Build APK Release lewat GitHub Actions

Workflow: `.github/workflows/build-android-release.yml`. Jalan otomatis saat
push tag `android-v*` (mis. `android-v1.0.0`), atau manual lewat tab
**Actions → Build ALFASTEC Android (Release APK) → Run workflow**.

APK release **wajib ditandatangani** dengan key yang sama setiap kali (kalau
key beda-beda tiap rilis, HP yang sudah pasang versi lama tidak akan bisa
di-update, harus uninstall dulu). Karena itu keystore-nya **dibuat sekali,
lalu dipakai terus** — bukan dibuat ulang otomatis oleh CI.

### Menyiapkan keystore release (dilakukan sekali, di komputer sendiri)

1. Buat keystore (ganti password contoh di bawah dengan password Anda sendiri,
   dan **simpan baik-baik** — kalau hilang, tidak bisa update APK yang sudah
   beredar dengan key yang sama lagi):
   ```bash
   keytool -genkeypair -v -keystore alfastec-release.keystore \
     -alias alfastec -keyalg RSA -keysize 2048 -validity 10000 \
     -storepass GANTI_PASSWORD_INI -keypass GANTI_PASSWORD_INI \
     -dname "CN=Una Digital Solution, OU=ALFASTEC, O=Una Digital Solution, L=Tangerang, ST=Banten, C=ID"
   ```
2. Encode ke base64 (untuk disimpan sebagai GitHub Secret):
   ```bash
   base64 -w0 alfastec-release.keystore > alfastec-release.keystore.b64
   ```
   (di macOS, ganti `-w0` menjadi `-i` atau cukup `base64 alfastec-release.keystore | tr -d '\n'`)
3. Di repo GitHub: **Settings → Secrets and variables → Actions → New repository secret**,
   tambahkan 4 secret ini:
   | Nama Secret | Isi |
   |---|---|
   | `ALFASTEC_KEYSTORE_BASE64` | isi file `alfastec-release.keystore.b64` |
   | `ALFASTEC_KEYSTORE_PASSWORD` | password keystore (`-storepass` di atas) |
   | `ALFASTEC_KEY_ALIAS` | `alfastec` (atau alias yang dipakai) |
   | `ALFASTEC_KEY_PASSWORD` | password key (`-keypass` di atas) |
4. Simpan file `.keystore` asli di tempat aman (bukan di repo Git) sebagai
   cadangan — GitHub Secret tidak bisa dibaca ulang setelah disimpan.

Setelah 4 secret ini ada, push tag `android-v1.0.0` (atau jalankan manual
lewat tab Actions) untuk memicu build. Hasil APK muncul di halaman run
tersebut, bagian **Artifacts**.

## Catatan keamanan
- Server hanya jalan di LAN (`usesCleartextTraffic` sengaja diaktifkan karena
  ini HTTP biasa, bukan HTTPS — aman selama tidak pernah dipaparkan ke internet).
- Token API kedaluwarsa 30 hari; kredensial offline disimpan sebagai hash
  PBKDF2 (150.000 iterasi), bukan password mentah.
- Rate limit login: maks. 8 percobaan gagal per 5 menit per alamat IP.
