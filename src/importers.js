import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const SLIDE_WIDTH = 1920;

export function fileKind(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (['txt', 'md', 'markdown'].includes(ext)) return 'text';
  return 'unknown';
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat gambar slide'))), 'image/png'),
  );
}

/** PDF → daftar gambar PNG, satu per halaman. */
export async function renderPdf(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false });
  const doc = await task.promise;
  const out = [];
  let aspect = 16 / 9;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    if (i === 1) aspect = base.width / base.height;
    const viewport = page.getViewport({ scale: SLIDE_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    out.push(await canvasToBlob(canvas));
    page.cleanup();
    onProgress?.(i, doc.numPages);
  }
  await task.destroy();
  return { blobs: out, aspect };
}

/** Beberapa gambar → slide, diurutkan menurut nama (slide2 sebelum slide10). */
export async function readImages(files) {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  let aspect = 16 / 9;
  if (sorted[0]) {
    const bmp = await createImageBitmap(sorted[0]);
    aspect = bmp.width / bmp.height;
    bmp.close();
  }
  return { blobs: sorted, aspect };
}

/* ---------- catatan dari PPTX ---------- */

const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function parseXml(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function resolvePart(baseDir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = `${baseDir}/${target}`.split('/');
  const out = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

async function readRels(zip, partPath) {
  const dir = partPath.substring(0, partPath.lastIndexOf('/'));
  const name = partPath.substring(partPath.lastIndexOf('/') + 1);
  const relFile = zip.file(`${dir}/_rels/${name}.rels`);
  const map = new Map();
  if (!relFile) return map;
  const xml = parseXml(await relFile.async('string'));
  for (const r of xml.getElementsByTagNameNS(NS_REL, 'Relationship')) {
    map.set(r.getAttribute('Id'), {
      type: r.getAttribute('Type') || '',
      target: resolvePart(dir, r.getAttribute('Target') || ''),
    });
  }
  return map;
}

/** Mengambil catatan pembicara (speaker notes) tiap slide dari berkas .pptx, sesuai urutan tampil. */
export async function pptxNotes(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const presPath = 'ppt/presentation.xml';
  const presFile = zip.file(presPath);
  if (!presFile) throw new Error('Berkas PPTX tidak dikenali');
  const pres = parseXml(await presFile.async('string'));
  const presRels = await readRels(zip, presPath);
  const ids = [...pres.getElementsByTagNameNS(NS_P, 'sldId')];
  const notes = [];
  for (const sld of ids) {
    const rid = sld.getAttributeNS(NS_R, 'id');
    const slidePath = presRels.get(rid)?.target;
    let text = '';
    if (slidePath) {
      const slideRels = await readRels(zip, slidePath);
      const notesRel = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'));
      const notesFile = notesRel && zip.file(notesRel.target);
      if (notesFile) {
        const xml = parseXml(await notesFile.async('string'));
        const paras = [];
        for (const sp of xml.getElementsByTagNameNS(NS_P, 'sp')) {
          const ph = sp.getElementsByTagNameNS(NS_P, 'ph')[0];
          if (!ph || ph.getAttribute('type') !== 'body') continue;
          for (const p of sp.getElementsByTagNameNS(NS_A, 'p')) {
            const runs = [...p.getElementsByTagNameNS(NS_A, 't')].map((t) => t.textContent);
            paras.push(runs.join(''));
          }
        }
        text = paras.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      }
    }
    notes.push(text);
  }
  return notes;
}

/* ---------- berkas catatan terpisah ---------- */

export async function readNotesFile(file) {
  const kind = fileKind(file);
  if (kind === 'docx') {
    const mammoth = await import('mammoth/mammoth.browser.js');
    const lib = mammoth.default || mammoth;
    const r = await lib.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value;
  }
  if (kind === 'pptx') {
    return { perSlide: await pptxNotes(file) };
  }
  return file.text();
}

const MARKER =
  /^\s*(?:#{1,6}\s*)?[[(]?\s*(?:slide|slaid|salindia|halaman|hal\.?|page|hlm\.?)\s*(?:ke\s*[-–]?\s*)?(\d{1,3})\s*[\])]?\s*[:.\-–—)]?\s*(.*)$/i;
const SEPARATOR = /^\s*(?:-{3,}|={3,}|\*{3,}|_{3,})\s*$/;

/**
 * Memecah teks catatan menjadi per slide.
 * Penanda yang dikenali: "Slide 1", "## Slide 2", "[Slide 3]", "Halaman 4:", atau garis "---".
 */
export function splitNotes(raw, slideCount) {
  const text = String(raw || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
  const lines = text.split('\n');

  const byNumber = new Map();
  let current = null;
  let found = 0;
  for (const line of lines) {
    const m = line.match(MARKER);
    if (m && m[2].length < 80) {
      current = Number(m[1]);
      found++;
      if (!byNumber.has(current)) byNumber.set(current, []);
      if (m[2].trim()) byNumber.get(current).push(m[2].trim());
      continue;
    }
    if (current !== null) byNumber.get(current).push(line);
  }
  if (found > 0) {
    const out = Array.from({ length: slideCount }, (_, i) => (byNumber.get(i + 1) || []).join('\n').trim());
    const extra = [...byNumber.keys()].filter((n) => n < 1 || n > slideCount);
    return { notes: out, method: 'marker', unmatched: extra.length };
  }

  if (lines.some((l) => SEPARATOR.test(l))) {
    const chunks = [];
    let buf = [];
    for (const line of lines) {
      if (SEPARATOR.test(line)) {
        chunks.push(buf.join('\n').trim());
        buf = [];
      } else buf.push(line);
    }
    chunks.push(buf.join('\n').trim());
    const clean = chunks.filter((c, i) => c || i < chunks.length - 1);
    const out = Array.from({ length: slideCount }, (_, i) => clean[i] || '');
    if (clean.length > slideCount) out[slideCount - 1] = [out[slideCount - 1], ...clean.slice(slideCount)].join('\n\n');
    return { notes: out, method: 'separator', unmatched: Math.max(0, clean.length - slideCount) };
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === slideCount) {
    return { notes: paragraphs, method: 'paragraph', unmatched: 0 };
  }
  const out = Array.from({ length: slideCount }, () => '');
  out[0] = text.trim();
  return { notes: out, method: 'single', unmatched: 0 };
}
