import { store, slideUrls, confirmAction } from '../store.js';
import { createProject, createDemoProject, notesInfoMessage, ImportError } from '../projects.js';
import { fileKind } from '../importers.js';
import { countWords } from '../script.js';
import { icon } from '../icons.js';
import { esc, el, $, formatDate, readingMinutes, toast } from '../util.js';

export async function renderLibrary(root, go) {
  root.innerHTML = '';
  const view = el(`
    <div class="lib">
      <header class="lib-head">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <h1>Sorot</h1>
            <p>Prompter paparan untuk narasumber</p>
          </div>
        </div>
        <div class="lib-actions">
          <button class="btn ghost" data-act="demo">${icon('sparkle')}<span>Coba contoh</span></button>
          <button class="btn primary" data-act="new">${icon('plus')}<span>Paparan baru</span></button>
        </div>
      </header>
      <main class="lib-body" aria-live="polite"><div class="lib-loading">Memuat paparan…</div></main>
    </div>`);
  root.append(view);

  view.querySelector('[data-act="new"]').onclick = () => openNewDialog(go);
  view.querySelector('[data-act="demo"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    try {
      const p = await createDemoProject();
      go(`/present/${p.id}`);
    } catch (err) {
      toast(`Gagal membuat contoh: ${err.message}`, 'error');
      e.currentTarget.disabled = false;
    }
  };

  const body = $('.lib-body', view);
  let projects = [];
  try {
    projects = await store.list();
  } catch (err) {
    body.innerHTML = `<p class="err">Gagal membaca daftar paparan: ${esc(err.message)}</p>`;
    return;
  }

  if (!projects.length) {
    body.innerHTML = '';
    body.append(emptyState(go));
    return;
  }

  const grid = el('<ul class="grid" role="list"></ul>');
  for (const p of projects) {
    const words = p.slides.reduce((n, s) => n + countWords(s.notes), 0);
    const withNotes = p.slides.filter((s) => s.notes.trim()).length;
    const card = el(`
      <li class="card">
        <button class="card-thumb" data-act="present" aria-label="Mulai paparan ${esc(p.title)}">
          <img alt="" loading="lazy" />
          <span class="card-play">${icon('play', 20)}</span>
        </button>
        <div class="card-body">
          <h2 title="${esc(p.title)}">${esc(p.title)}</h2>
          <p class="meta">${p.slides.length} slide · catatan ${withNotes}/${p.slides.length} · ${readingMinutes(words)}</p>
          <p class="meta dim">Diubah ${esc(formatDate(p.updatedAt))}</p>
        </div>
        <div class="card-actions">
          <button class="btn sm primary" data-act="present">${icon('play', 16)}<span>Mulai</span></button>
          <button class="btn sm ghost" data-act="edit">${icon('edit', 16)}<span>Sunting catatan</span></button>
          <button class="btn sm icon-only ghost danger" data-act="delete" aria-label="Hapus ${esc(p.title)}" title="Hapus">${icon('trash', 16)}</button>
        </div>
      </li>`);
    slideUrls({ ...p, slides: p.slides.slice(0, 1) }).then(([u]) => {
      if (u) card.querySelector('img').src = u;
    });
    card.querySelectorAll('[data-act="present"]').forEach((b) => (b.onclick = () => go(`/present/${p.id}`)));
    card.querySelector('[data-act="edit"]').onclick = () => go(`/edit/${p.id}`);
    card.querySelector('[data-act="delete"]').onclick = async () => {
      if (!(await confirmAction(`Hapus paparan "${p.title}"?`, 'Slide dan catatannya ikut terhapus dari aplikasi ini. Berkas asli di komputer tidak tersentuh.'))) return;
      await store.remove(p.id);
      card.remove();
      toast('Paparan dihapus.');
      if (!grid.children.length) renderLibrary(root, go);
    };
    grid.append(card);
  }
  body.innerHTML = '';
  body.append(el(`<h2 class="section-title">Paparan tersimpan <span class="count">${projects.length}</span></h2>`), grid);
}

function emptyState(go) {
  const box = el(`
    <section class="empty">
      <h2>Siapkan paparan pertama</h2>
      <ol class="steps">
        <li><strong>Unggah slide</strong><span>PDF, PPTX, atau kumpulan gambar.</span></li>
        <li><strong>Tambahkan naskah</strong><span>Speaker notes PPTX terbaca otomatis, atau unggah TXT/DOCX dengan penanda "Slide 1", "Slide 2".</span></li>
        <li><strong>Tampil</strong><span>Naskah menyala mengikuti suara Anda di bagian atas layar, dekat kamera, dengan slide di bawahnya.</span></li>
      </ol>
      <div class="empty-actions">
        <button class="btn primary lg" data-act="new">${icon('upload')}<span>Unggah paparan</span></button>
        <button class="btn ghost lg" data-act="demo">${icon('sparkle')}<span>Coba dengan contoh</span></button>
      </div>
    </section>`);
  box.querySelector('[data-act="new"]').onclick = () => openNewDialog(go);
  box.querySelector('[data-act="demo"]').onclick = async () => {
    const p = await createDemoProject();
    go(`/present/${p.id}`);
  };
  return box;
}

export function openNewDialog(go) {
  const dlg = el(`
    <dialog class="dialog" aria-labelledby="nd-title">
      <form method="dialog" class="dialog-inner">
        <header class="dialog-head">
          <h2 id="nd-title">Paparan baru</h2>
          <button type="button" class="btn icon-only ghost" data-act="close" aria-label="Tutup">${icon('x')}</button>
        </header>

        <label class="field">
          <span class="label">Judul paparan</span>
          <input name="title" type="text" placeholder="Mis. Rakor DAK Jalan 2027" autocomplete="off" />
        </label>

        <div class="field">
          <span class="label" id="lbl-slides">Slide <em>wajib</em></span>
          <label class="drop" data-for="slides">
            <input type="file" name="slides" accept=".pdf,.pptx,.ppt,.png,.jpg,.jpeg,.webp" multiple aria-labelledby="lbl-slides" />
            ${icon('upload', 22)}
            <span class="drop-main">Seret berkas ke sini atau <u>pilih berkas</u></span>
            <span class="drop-sub">PDF, PPTX, atau beberapa gambar PNG/JPG</span>
            <span class="drop-file" hidden></span>
          </label>
        </div>

        <div class="field">
          <span class="label" id="lbl-notes">Naskah / catatan <em>opsional</em></span>
          <label class="drop small" data-for="notes">
            <input type="file" name="notes" accept=".txt,.md,.docx,.pptx" aria-labelledby="lbl-notes" />
            ${icon('file', 20)}
            <span class="drop-main">TXT, DOCX, MD, atau PPTX berisi speaker notes</span>
            <span class="drop-file" hidden></span>
          </label>
          <details class="hint">
            <summary>Cara menulis naskah agar terbagi per slide</summary>
            <pre>Slide 1
Selamat pagi Bapak dan Ibu sekalian…

Slide 2
Pertama, kondisi saat ini… [JEDA]

Slide 3
…</pre>
            <p>Penanda lain yang juga dikenali: <code>## Slide 2</code>, <code>[Slide 2]</code>, <code>Halaman 2:</code>, atau garis <code>---</code> di antara bagian. Teks dalam kurung siku seperti <code>[JEDA]</code> atau <code>[KLIK]</code> tampil sebagai penanda dan tidak perlu dibaca.</p>
            <p>Jika slide berupa PPTX yang sudah berisi speaker notes, kolom ini boleh dikosongkan.</p>
          </details>
        </div>

        <p class="status" role="status" aria-live="polite"></p>

        <footer class="dialog-foot">
          <button type="button" class="btn ghost" data-act="close">Batal</button>
          <button type="submit" class="btn primary" data-act="create" disabled>Buat paparan</button>
        </footer>
      </form>
    </dialog>`);
  document.body.append(dlg);

  const form = dlg.querySelector('form');
  const status = dlg.querySelector('.status');
  const createBtn = dlg.querySelector('[data-act="create"]');
  const files = { slides: [], notes: null };

  const setFiles = (key, list) => {
    const input = form.elements[key];
    const drop = dlg.querySelector(`.drop[data-for="${key}"]`);
    const label = drop.querySelector('.drop-file');
    if (key === 'slides') {
      const valid = list.filter((f) => ['pdf', 'pptx', 'image'].includes(fileKind(f)));
      files.slides = valid;
      if (list.length && !valid.length) {
        status.textContent = 'Berkas slide harus PDF, PPTX, atau gambar.';
        status.dataset.kind = 'error';
      } else status.textContent = '';
      label.textContent = valid.length === 1 ? valid[0].name : valid.length ? `${valid.length} gambar dipilih` : '';
      if (valid.length && !form.elements.title.value.trim()) {
        form.elements.title.value = valid[0].name.replace(/\.[^.]+$/, '');
      }
    } else {
      const f = list[0] || null;
      files.notes = f && ['docx', 'text', 'pptx'].includes(fileKind(f)) ? f : null;
      label.textContent = files.notes ? files.notes.name : '';
    }
    label.hidden = !label.textContent;
    drop.classList.toggle('has-file', !label.hidden);
    createBtn.disabled = !files.slides.length;
    input.value = '';
  };

  for (const key of ['slides', 'notes']) {
    const drop = dlg.querySelector(`.drop[data-for="${key}"]`);
    form.elements[key].addEventListener('change', (e) => setFiles(key, [...e.target.files]));
    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.classList.add('over');
    });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      setFiles(key, [...e.dataTransfer.files]);
    });
  }

  const close = () => {
    dlg.close();
    dlg.remove();
  };
  dlg.querySelectorAll('[data-act="close"]').forEach((b) => (b.onclick = close));
  dlg.addEventListener('cancel', (e) => {
    if (createBtn.dataset.busy) e.preventDefault();
    else setTimeout(() => dlg.remove(), 0);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!files.slides.length) return;
    createBtn.disabled = true;
    createBtn.dataset.busy = '1';
    status.dataset.kind = 'info';
    status.textContent = 'Memproses…';
    try {
      const { project, notesInfo } = await createProject(
        { title: form.elements.title.value.trim(), slideFiles: files.slides, notesFile: files.notes },
        (msg) => (status.textContent = msg),
      );
      close();
      const msg = notesInfoMessage(notesInfo, project.slides.length);
      go(`/edit/${project.id}`);
      if (msg) toast(msg, notesInfo.method === 'single' ? 'warn' : 'info', 7000);
    } catch (err) {
      status.dataset.kind = 'error';
      status.textContent = err instanceof ImportError ? err.message : `Gagal memproses berkas: ${err.message}`;
      createBtn.disabled = false;
      delete createBtn.dataset.busy;
    }
  });

  dlg.showModal();
  form.elements.title.focus();
}
