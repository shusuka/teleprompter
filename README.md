# Sorot

Prompter paparan untuk narasumber. Naskah tampil di bagian atas layar, dekat webcam, dan slide di bawahnya. Kata yang sedang Anda ucapkan menyala, jadi Anda bisa membaca sambil tetap terlihat menatap kamera.

## Fitur

- **Naskah mengikuti suara.** Pengenal suara Whisper berjalan di komputer sendiri (bahasa Indonesia atau Inggris). Internet hanya dipakai sekali untuk mengunduh model.
- **Tiga cara gerak:** Suara, Otomatis (kecepatan kata/menit), dan Manual (panah atau klik kata).
- **Slide pindah otomatis** saat Anda mulai membaca naskah slide berikutnya.
- **Unggah slide** dalam bentuk PDF, PPTX (butuh Microsoft PowerPoint terpasang), atau kumpulan gambar.
- **Naskah otomatis** dari speaker notes PPTX, atau dari berkas TXT / DOCX / MD dengan penanda `Slide 1`, `Slide 2`, dst.
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

Data paparan tersimpan di `%APPDATA%\Sorot\paparan`.
