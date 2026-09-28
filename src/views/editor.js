import { store, slideUrls, isDesktop, desktopApi } from '../store.js';
import { importNotesInto, replaceSlides, notesInfoMessage, ImportError } from '../projects.js';
import { fileKind } from '../importers.js';
import { countWords } from '../script.js';
import { icon } from '../icons.js';
import { esc, el, $, debounce, readingMinutes, toast } from '../util.js';

export async function renderEditor(root, go, id) {
  root.innerHTML = '<div class="lib-loading">Memuat…</div>';
  let project;
  try {
    project = await store.get(id);
  } catch {
    project = null;
  }
  if (!project) {
    root.innerHTML = '';
    root.append(el(`<div class="missing"><p>Paparan tidak ditemukan.</p><a class="btn" href="#/">Kembali ke daftar</a></div>`));
    return;
  }

  const view = el(`
    <div class="editor">
      <header class="topbar">
        <button class="btn icon-only ghost" data-act="back" aria-label="Kembali ke daftar" title="Kembali">${icon('back')}</button>
        <input class="title-input" value="${esc(project.title)}" aria-label="Judul paparan" />
        <span class="save-state" aria-live="polite">Tersimpan</span>
        <div class="spacer"></div>
        <label class="btn ghost file-btn">${icon('file')}<span>Impor naskah</span>
          <input type="file" accept=".txt,.md,.docx,.pptx" data-act="notes" hidden /></label>
        <label class="btn ghost file-btn">${icon('upload')}<span>Ganti slide</span>
          <input type="file" accept=".pdf,.pptx,.png,.jpg,.jpeg,.webp" multiple data-act="slides" hidden /></label>
        ${isDesktop ? `<button class="btn icon-only ghost" data-act="reveal" aria-label="Buka folder data" title="Buka folder data">${icon('folder')}</button>` : ''}
        <button class="btn primary" data-act="present">${icon('play')}<span>Mulai paparan</span></button>
      </header>
      <div class="editor-summary"></div>
      <p class="editor-tip">Tulis naskah seperti yang akan diucapkan. Kata dalam kurung siku, misalnya <code>[JEDA]</code> atau <code>[KLIK]</code>, tampil sebagai penanda dan tidak perlu dibaca.</p>
      <ol class="slides" role="list"></ol>
    </div>`);
  root.innerHTML = '';
  root.append(view);

  const saveState = $('.save-state', view);
  const summary = $('.editor-summary', view);
  const list = $('.slides', view);

  const persist = debounce(async () => {
    project.updatedAt = Date.now();
    try {
      await store.save(project);
      saveState.textContent = 'Tersimpan';
      saveState.dataset.state = '';
    } catch (err) {
      saveState.textContent = 'Gagal menyimpan';
      saveState.dataset.state = 'error';
      toast(`Gagal menyimpan: ${err.message}`, 'error');
    }
  }, 500);
  const touch = () => {
    saveState.textContent = 'Menyimpan…';
    saveState.dataset.state = 'busy';
    persist();
  };

  const updateSummary = () => {
    const words = project.slides.reduce((n, s) => n + countWords(s.notes), 0);
    const empty = project.slides.filter((s) => !s.notes.trim()).length;
    summary.innerHTML = `
      <span><strong>${project.slides.length}</strong> slide</span>
      <span><strong>${words.toLocaleString('id-ID')}</strong> kata</span>
      <span>durasi baca <strong>${readingMinutes(words)}</strong></span>
      ${empty ? `<span class="warn">${empty} slide belum ada naskah</span>` : ''}`;
  };

  const autosize = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 120)}px`;
  };

  async function renderSlides() {
    list.innerHTML = '';
    const urls = await slideUrls(project);
    project.slides.forEach((s, i) => {
      const words = countWords(s.notes);
      const item = el(`
        <li class="slide-row">
          <figure class="slide-thumb" style="aspect-ratio:${project.aspect}">
            <img src="${esc(urls[i])}" alt="Slide ${i + 1}" loading="lazy" />
            <figcaption>${i + 1}</figcaption>
          </figure>
          <div class="slide-notes">
            <label class="sr-only" for="n-${i}">Naskah slide ${i + 1}</label>
            <textarea id="n-${i}" spellcheck="false" placeholder="Naskah untuk slide ${i + 1}…">${esc(s.notes)}</textarea>
            <div class="notes-meta"><span data-wc>${words} kata · ${readingMinutes(words)}</span>
              <button class="link" data-act="from-here">${icon('play', 14)}Mulai dari slide ini</button></div>
          </div>
        </li>`);
      const ta = $('textarea', item);
      ta.addEventListener('input', () => {
        s.notes = ta.value;
        const n = countWords(ta.value);
        $('[data-wc]', item).textContent = `${n} kata · ${readingMinutes(n)}`;
        autosize(ta);
        updateSummary();
        touch();
      });
      $('[data-act="from-here"]', item).onclick = () => {
        persist.flush();
        go(`/present/${project.id}?slide=${i}`);
      };
      list.append(item);
      requestAnimationFrame(() => autosize(ta));
    });
    updateSummary();
  }

  await renderSlides();

  $('.title-input', view).addEventListener('input', (e) => {
    project.title = e.target.value.trim() || 'Paparan tanpa judul';
    touch();
  });
  $('[data-act="back"]', view).onclick = () => {
    persist.flush();
    go('/');
  };
  $('[data-act="present"]', view).onclick = () => {
    persist.flush();
    go(`/present/${project.id}`);
  };
  $('[data-act="reveal"]', view)?.addEventListener('click', () => desktopApi.revealProject(project.id));

  $('[data-act="notes"]', view).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!['docx', 'text', 'pptx'].includes(fileKind(file))) {
      toast('Naskah harus TXT, MD, DOCX, atau PPTX.', 'error');
      return;
    }
    const hasNotes = project.slides.some((s) => s.notes.trim());
    if (hasNotes && !window.confirm('Naskah yang sudah ada akan diganti dengan isi berkas ini. Lanjutkan?')) return;
    try {
      const info = await importNotesInto(project, file);
      await renderSlides();
      toast(notesInfoMessage(info, project.slides.length), info.method === 'single' ? 'warn' : 'info', 7000);
    } catch (err) {
      toast(`Gagal membaca naskah: ${err.message}`, 'error');
    }
  });

  $('[data-act="slides"]', view).addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    toast('Memproses slide…', 'info', 60000);
    try {
      await replaceSlides(project, files, (m) => toast(m, 'info', 60000));
      await renderSlides();
      toast('Slide diganti. Naskah tetap di tempatnya.');
    } catch (err) {
      toast(err instanceof ImportError ? err.message : `Gagal mengganti slide: ${err.message}`, 'error', 8000);
    }
  });

  return () => persist.flush();
}

