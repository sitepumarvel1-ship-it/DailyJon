# DailyJon

DailyJon adalah planner harian dengan grid 10 menit, pelacak kebiasaan, dan asisten AI bernama Jon. Gratis, tanpa iklan, dan semua data disimpan di perangkat.

## Pasang di GitHub Pages
1. Buat repo baru, misalnya `dailyjon`.
2. Unggah semua isi folder ini ke root repo: `index.html`, `manifest.json`, `sw.js`, dan folder `icons/`.
3. Buka Settings, lalu Pages. Pada Source, pilih `Deploy from a branch`, lalu pilih `main` / `(root)`.
4. Tunggu 1–2 menit. Aplikasinya akan tersedia di `https://USERNAME.github.io/dailyjon/`.

## Pasang di iPhone
Buka link di atas lewat Safari. Ketuk Bagikan, lalu Tambahkan ke Layar Utama.

## Update
Setelah file di repo diganti, buka DailyJon dua kali supaya versi baru termuat. Untuk memaksa pembaruan, naikkan versi `V` di `sw.js`.

## Notifikasi push (opsional)
Supaya pengingat tetap muncul saat DailyJon tertutup:
1. Di Cloudflare, buat Worker baru bernama `dailyjon-push`, lalu tempel isi `push-worker/worker.js`.
2. Buat KV namespace, lalu hubungkan ke Worker dengan nama binding `KV`.
3. Tambahkan Cron Trigger `* * * * *`.
4. Di DailyJon, buka Setelan → Notifikasi di iPhone. Tempel alamat Worker, ketuk Hubungkan, lalu Aktifkan.

Panduan lengkapnya ada di dalam aplikasi, termasuk tombol untuk menyalin kode server.
