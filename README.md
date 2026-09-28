# Sorot

Prompter paparan untuk narasumber. Naskah tampil di bagian atas layar, dekat webcam, dan slide di bawahnya. Kata yang sedang Anda ucapkan menyala, jadi Anda bisa membaca sambil tetap terlihat menatap kamera.

## Fitur

- **Naskah mengikuti suara**, dengan dua pilihan mesin:
  - *Di komputer (Whisper)*: gratis dan offline. Internet hanya dipakai sekali untuk mengunduh model. Jedanya 1–2 detik.
  - *Deepgram Nova-3 (cloud)*: butuh internet dan API key dari [console.deepgram.com](https://console.deepgram.com/signup). Jedanya ±0,3 detik dan jauh lebih akurat untuk bahasa Indonesia. Kata-kata khas naskah dikirim sebagai petunjuk (keyterm) agar lebih mudah dikenali.
- **Tiga cara gerak:** Suara, Otomatis (kecepatan kata/menit), dan Manual (panah atau klik kata).
- **Slide pindah otomatis** saat Anda mulai membaca naskah slide berikutnya.
- **Unggah slide** dalam bentuk PDF, PPTX (butuh Microsoft PowerPoint terpasang), atau kumpulan gambar.
- **Naskah otomatis** dari speaker notes PPTX, atau dari berkas TXT / DOCX / MD dengan penanda `Slide 1`, `Slide 2`, dst.
- **Sinkron dengan PowerPoint**: tombol *PowerPoint* di bilah atas menempel ke slideshow yang sedang berjalan. Saat Sorot pindah slide (suara, klik, atau clicker), PowerPoint ikut pindah. Saat slide dipindah di PowerPoint, naskah di Sorot ikut melompat. Tombol `B` juga menggelapkan slideshow.
- **Layar penonton**: slide tampil penuh di proyektor atau layar kedua, dan tombol `B` untuk menggelapkannya.
- Tata letak naskah di atas atau di bawah, ukuran huruf, jarak baris, garis baca, mode cermin untuk kaca teleprompter, timer, dan jam.

## Menulis naskah

```
Slide 1
Selamat pagi Bapak dan Ibu sekalian…

Slide 2
Pertama, kondisi saat ini. [KLIK] Data pada slide ini…

Slide 3
Demikian paparan saya. [JEDA] Terima kasih.
```

Penanda `## Slide 2`, `[Slide 2]`, `Halaman 2:`, atau garis `---` di antara bagian juga dikenali. Teks dalam kurung siku seperti `[JEDA]` dan `[KLIK]` tampil sebagai penanda dan tidak perlu dibaca.

## Pintasan saat paparan

| Tombol | Fungsi |
| --- | --- |
| Spasi | Mulai / berhenti |
| → / PgDn | Slide berikutnya (cocok untuk clicker presentasi) |
| ← / PgUp | Slide sebelumnya |
| ↓ / ↑ | Maju / mundur satu baris naskah |
| Klik kata | Lompat ke kata itu |
| + / − | Ukuran huruf |
| B | Gelapkan layar penonton |
| F | Layar penuh |
| Esc dua kali | Keluar dari paparan |

## Pengembangan

```bash
npm install
npm run app:dev     # Vite + Electron
npm run dist        # membuat installer & versi portable di folder release/
npm run dist:local  # sama, memakai Electron dari node_modules (bila unduhan/ekstrak diblokir antivirus)
```

Membuat tag `v*` (mis. `v1.0.0`) di GitHub akan menjalankan workflow yang membangun exe dan melampirkannya ke halaman Releases.

Versi installer memeriksa pembaruan setiap kali dibuka, mengunduhnya di latar belakang, lalu menawarkan tombol "Pasang dan mulai ulang". Versi portable hanya memberi tahu bahwa ada versi baru.

Data paparan tersimpan di `%APPDATA%\Sorot\paparan`. API key disimpan terenkripsi di `%APPDATA%\Sorot\secrets.json`.
