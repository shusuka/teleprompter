import { store, isDesktop, desktopApi } from './store.js';
import { fileKind, renderPdf, readImages, pptxNotes, readNotesFile, splitNotes } from './importers.js';

const pad = (n) => String(n).padStart(3, '0');

export class ImportError extends Error {}

/** Mengisi slide sebuah paparan dari berkas yang dipilih. Mengembalikan { images, aspect, notes? }. */
async function importSlides(id, files, onStatus) {
  const list = [...files];
  const kinds = new Set(list.map(fileKind));
  if (kinds.has('pptx')) {
    const file = list.find((f) => fileKind(f) === 'pptx');
    if (!file.name.toLowerCase().endsWith('.pptx')) {
      throw new ImportError('Format .ppt lama belum didukung. Buka di PowerPoint lalu simpan sebagai .pptx atau PDF.');
    }
    onStatus?.('Membaca catatan pembicara dari PPTX…');
    const notes = await pptxNotes(file).catch(() => null);
    if (!isDesktop) {
      throw new ImportError('Mengubah PPTX menjadi gambar butuh aplikasi Sorot di Windows. Untuk sementara, simpan slide sebagai PDF.');
    }
    const path = desktopApi.pathForFile(file);
    if (!path) throw new ImportError('Lokasi berkas PPTX tidak terbaca. Coba pilih ulang berkasnya.');
    onStatus?.('Mengubah slide lewat PowerPoint… (bisa 10–60 detik)');
    await store.clearSlides(id);
    const r = await desktopApi.exportPptx(id, path);
    if (!r.ok) {
      if (r.reason === 'no-powerpoint') {
        throw new ImportError('Microsoft PowerPoint tidak ditemukan di komputer ini. Simpan presentasi sebagai PDF, lalu unggah PDF-nya (catatan tetap bisa diambil dari PPTX).');
      }
      throw new ImportError(`PowerPoint gagal mengubah slide. ${r.detail || ''}`.trim());
    }
    return { images: r.files, aspect: r.aspect, notes };
  }

  if (kinds.has('pdf')) {
    const file = list.find((f) => fileKind(f) === 'pdf');
    await store.clearSlides(id);
    const { blobs, aspect } = await renderPdf(file, (i, n) => onStatus?.(`Menyiapkan slide ${i} dari ${n}…`));
    const images = [];
    for (let i = 0; i < blobs.length; i++) images.push(await store.writeSlide(id, `s${pad(i + 1)}.png`, blobs[i]));
    return { images, aspect };
  }

  const imgs = list.filter((f) => fileKind(f) === 'image');
  if (imgs.length) {
    await store.clearSlides(id);
    const { blobs, aspect } = await readImages(imgs);
    const images = [];
    for (let i = 0; i < blobs.length; i++) {
      onStatus?.(`Menyalin gambar ${i + 1} dari ${blobs.length}…`);
      const ext = blobs[i].name.toLowerCase().split('.').pop();
      images.push(await store.writeSlide(id, `s${pad(i + 1)}.${ext === 'jpeg' ? 'jpg' : ext}`, blobs[i]));
    }
    return { images, aspect };
  }

  throw new ImportError('Berkas slide belum dikenali. Gunakan PDF, PPTX, atau gambar (PNG/JPG).');
}

export async function createProject({ title, slideFiles, notesFile }, onStatus) {
  const id = await store.create();
  try {
    const { images, aspect, notes: pptNotes } = await importSlides(id, slideFiles, onStatus);
    let notes = pptNotes || [];
    let notesInfo = pptNotes && pptNotes.some(Boolean) ? { method: 'pptx' } : null;
    if (notesFile) {
      onStatus?.('Membaca berkas catatan…');
      const r = await readNotesFile(notesFile);
      if (r && r.perSlide) {
        notes = r.perSlide;
        notesInfo = { method: 'pptx' };
      } else {
        const split = splitNotes(r, images.length);
        notes = split.notes;
        notesInfo = split;
      }
    }
    const now = Date.now();
    const project = {
      id,
      title: title || stripExt(slideFiles[0]?.name) || 'Paparan tanpa judul',
      createdAt: now,
      updatedAt: now,
      slidesVersion: now,
      aspect: aspect || 16 / 9,
      slides: images.map((image, i) => ({ image, notes: notes[i] || '' })),
    };
    await store.save(project);
    return { project, notesInfo };
  } catch (err) {
    await store.remove(id).catch(() => {});
    throw err;
  }
}

/** Mengganti slide tanpa menghapus catatan yang sudah ditulis. */
export async function replaceSlides(project, slideFiles, onStatus) {
  const { images, aspect, notes } = await importSlides(project.id, slideFiles, onStatus);
  const old = project.slides;
  project.slides = images.map((image, i) => ({
    image,
    notes: old[i]?.notes || (notes && notes[i]) || '',
  }));
  // Catatan slide yang kini tidak ada lagi ditempel ke slide terakhir agar tidak hilang.
  const orphan = old.slice(images.length).map((s) => s.notes).filter(Boolean);
  if (orphan.length && project.slides.length) {
    const last = project.slides[project.slides.length - 1];
    last.notes = [last.notes, ...orphan].filter(Boolean).join('\n\n');
  }
  project.aspect = aspect || project.aspect;
  project.slidesVersion = Date.now();
  project.updatedAt = Date.now();
  await store.save(project);
  return project;
}

export async function importNotesInto(project, file) {
  const r = await readNotesFile(file);
  let info;
  let notes;
  if (r && r.perSlide) {
    notes = r.perSlide;
    info = { method: 'pptx' };
  } else {
    info = splitNotes(r, project.slides.length);
    notes = info.notes;
  }
  project.slides.forEach((s, i) => {
    s.notes = notes[i] || '';
  });
  project.updatedAt = Date.now();
  await store.save(project);
  return info;
}

export function stripExt(name = '') {
  return name.replace(/\.[^.]+$/, '');
}

export function notesInfoMessage(info, slideCount) {
  if (!info) return '';
  switch (info.method) {
    case 'pptx':
      return 'Catatan diambil dari speaker notes PowerPoint.';
    case 'marker':
      return info.unmatched
        ? `Catatan dibagi menurut penanda "Slide N". ${info.unmatched} penanda melebihi jumlah slide (${slideCount}).`
        : 'Catatan dibagi menurut penanda "Slide N".';
    case 'separator':
      return 'Catatan dibagi menurut garis pemisah ---.';
    case 'paragraph':
      return 'Tiap paragraf dipasangkan ke satu slide.';
    default:
      return 'Tidak ada penanda slide, jadi semua catatan masuk ke slide 1. Pindahkan per slide di penyunting, atau beri penanda "Slide 1", "Slide 2", dst.';
  }
}

/* ---------- paparan contoh ---------- */

const DEMO = [
  {
    kicker: 'PAPARAN CONTOH',
    title: 'Membaca naskah\nsambil menatap kamera',
    notes:
      'Selamat pagi, Bapak dan Ibu sekalian. Terima kasih atas kesempatan yang diberikan kepada saya untuk menyampaikan paparan hari ini. [JEDA] Dalam beberapa menit ke depan, saya akan menjelaskan tiga hal pokok yang perlu kita sepakati bersama.',
  },
  {
    kicker: 'BAGIAN 1',
    title: 'Kondisi saat ini',
    notes:
      'Pertama, mari kita lihat kondisi saat ini. Sebagian besar kegiatan sudah berjalan sesuai rencana, namun masih ada beberapa daerah yang membutuhkan pendampingan tambahan. [KLIK] Data pada slide ini menunjukkan capaian per wilayah hingga akhir triwulan kedua.',
  },
  {
    kicker: 'BAGIAN 2',
    title: 'Langkah berikutnya',
    notes:
      'Kedua, langkah yang kami usulkan adalah memperkuat koordinasi antar instansi dan mempercepat verifikasi dokumen. Ketiga, kami berharap dukungan Bapak dan Ibu untuk memantau pelaksanaannya secara berkala. [JEDA] Demikian paparan dari saya. Terima kasih.',
  },
];

function drawDemoSlide(d, i, n) {
  const c = document.createElement('canvas');
  c.width = 1920;
  c.height = 1080;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f1ea';
  g.fillRect(0, 0, 1920, 1080);
  g.fillStyle = '#0f766e';
  g.fillRect(0, 0, 24, 1080);
  g.fillStyle = '#0f766e';
  g.font = '600 34px "Inter Variable", Inter, "Segoe UI", sans-serif';
  g.fillText(d.kicker, 150, 330);
  g.fillStyle = '#1c1917';
  g.font = '700 112px "Inter Variable", Inter, "Segoe UI", sans-serif';
  d.title.split('\n').forEach((line, k) => g.fillText(line, 144, 470 + k * 132));
  g.fillStyle = '#78716c';
  g.font = '500 30px "Inter Variable", Inter, "Segoe UI", sans-serif';
  g.fillText(`${i + 1} / ${n}`, 150, 960);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

export async function createDemoProject() {
  const id = await store.create();
  const slides = [];
  for (let i = 0; i < DEMO.length; i++) {
    const blob = await drawDemoSlide(DEMO[i], i, DEMO.length);
    const image = await store.writeSlide(id, `s${pad(i + 1)}.png`, blob);
    slides.push({ image, notes: DEMO[i].notes });
  }
  const now = Date.now();
  const project = { id, title: 'Contoh paparan', createdAt: now, updatedAt: now, slidesVersion: now, aspect: 16 / 9, slides };
  await store.save(project);
  return project;
}
