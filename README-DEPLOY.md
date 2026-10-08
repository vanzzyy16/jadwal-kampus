# Jadwal Kampus — Cara Online-kan (bisa dibuka dari HP)

Web ini 100% statis, jadi GRATIS di Vercel. Pilih salah satu cara:

## Cara 1 — Paling gampang (tanpa install, 2 menit)
1. Buka https://vercel.com → Sign up / Login (bisa pakai GitHub/Google).
2. Di dashboard klik **Add New → Project → Deploy**? Kalau belum ada repo,
   pakai trik: install GitHub Desktop / upload folder ini ke GitHub dulu,
   ATAU langsung drag-and-drop lewat https://vercel.com/new (pilih repo).
3. Paling cepat tanpa repo: buka https://app.netlify.com/drop,
   drag folder `proyek 1` → langsung dapat link online. (Alternatif Netlify.)

## Cara 2 — Via terminal (di folder ini)
```
npm i -g vercel
vercel login
vercel --prod
```
Ikuti prompt (tekan Enter semua) → dapat URL `https://jadwal-kampus.vercel.app` (atau nama lain yang kamu pilih).

## Cara 3 — Via GitHub + Vercel (otomatis update tiap push)
```
cd "c:\Users\Beater\Desktop\proyek 1"
git init
git add .
git commit -m "Jadwal Kampus v1.3"
git branch -M main
git remote add origin https://github.com/USERNAME/jadwal-kampus.git
git push -u origin main
```
Lalu di vercel.com → Add New → Project → Import repo `jadwal-kampus` → Deploy.

## Ganti dengan jadwal ASLI kampus
- Punya Excel/CSV teori? Buka web → bagian "1. Import Teori" → upload → Proses Excel Teori.
- Punya Excel/CSV praktikum? Bagian "2. Import Praktikum" → upload → Proses Excel Praktikum.
- Format kolom keduanya SAMA PERSIS: matkul,kode,sks,hari,tipe,mulai,selesai,kelas,ruang,dosen,prodi
  (klik template-teori.csv / template-praktikum.csv di web untuk contoh).
- Atau unduh template langsung dari web (tombol ⬇ template-teori.csv / template-praktikum.csv di panel Import), isi di Excel, lalu import lewat web.
- Data tersimpan otomatis di browser (localStorage), jadi tiap HP/mahasiswa
  bisa simpan jadwalnya sendiri.

## File di folder ini
- index.html, styles.css, app.js → web utama
- template-teori.csv / template-praktikum.csv → unduh langsung dari web (tombol di panel Import)
- manifest.webmanifest, icon.svg → biar bisa "Install" di HP (PWA)
- vercel.json, package.json → konfigurasi deploy
