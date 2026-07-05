# Talenta Timesheet Helper (Personal Use)

Extension Chrome untuk isi timesheet Talenta otomatis dari template Excel,
tanpa DOM automation — langsung panggil API yang sama dipakai halaman
Talenta, memakai sesi login browser kamu sendiri.

## Cara Install (Developer Mode)

1. Buka Chrome, ketik di address bar: `chrome://extensions`
2. Aktifkan toggle **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked**
4. Pilih folder `timesheet-helper` ini (folder yang berisi `manifest.json`)
5. Extension akan muncul di toolbar Chrome (ikon puzzle piece → pin biar keliatan)

## Cara Pakai

1. **Login dan buka Talenta** di tab Chrome (`https://hr.talenta.co`)
2. Klik ikon extension di toolbar
3. Klik **"Cek Koneksi & Ambil Daftar Task"** — ini mengambil daftar task
   kamu (Public Holiday, Sick Leave, project kerja, dll) langsung dari
   Talenta, jadi selalu up to date
4. Isi file Excel dari `template-timesheet.xlsx` (ada di folder
   `timesheet-helper-example`), kolom yang wajib diisi:
   - `Date` — tanggal (format bebas, misal "Tuesday, 02 June 2026")
   - `Clock In` — jam masuk (format `08:00`)
   - `Clock Out` — jam pulang (format `17:00`)
   - `Task Code` — pilih dari dropdown (sudah otomatis tersedia di
     kolom D, sesuai daftar task yang diambil dari Talenta)
   - `Work Detail` — deskripsi pekerjaan/keterangan
5. Upload file Excel itu di popup extension
6. Cek **preview** — baris yang error akan ditandai merah dengan alasan
   spesifiknya, baris valid ditandai hijau
7. Klik **"Submit Semua ke Talenta"** — extension akan isi satu per satu
   dengan jeda natural, progress-nya kelihatan real-time
8. Kalau ada yang salah di tengah jalan, klik **Stop** kapan saja

## Kenapa Task Code, bukan pilih "Jenis" terpisah?

Di sistem Talenta kamu, "jenis" entry (kerja/cuti/sakit/public holiday)
itu **sebenarnya adalah pilihan task**, bukan field terpisah. Jadi kalau
kamu pilih Task Code `G2020AE005` (Public Holidays), otomatis itu sudah
benar jenisnya — nggak mungkin ketuker sama Work Detail yang isinya
pekerjaan, karena keduanya memang satu kesatuan pilihan.

## Update Daftar Task

Kalau company kamu nambah project baru, klik lagi tombol
**"Cek Koneksi & Ambil Daftar Task"** di popup — daftar akan ter-refresh
otomatis dari Talenta, gak perlu update kode.

## Keamanan

- Extension ini **tidak pernah mengirim token/cookie kamu ke server
  manapun** — semua request `fetch()` jalan langsung dari browser kamu
  ke Talenta, sama seperti kalau kamu isi manual
- Tidak ada backend, tidak ada data yang disimpan di luar browser kamu
- Source code 100% bisa diperiksa (`content-script/content.js` dan
  `popup/popup.js`) — nggak ada request ke domain lain selain
  `hr.talenta.co`

## Known Limitations (MVP)

- Kalau Talenta mengubah struktur endpoint API, extension ini perlu
  di-update (lihat konstanta `API_BASE` di `content-script/content.js`)
- Belum ada dukungan multi-sheet / multi-bulan sekaligus — 1 file Excel
  = 1 bulan
- Belum ada reminder deadline otomatis (rencana fase berikutnya)
