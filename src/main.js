import '@fontsource-variable/inter';
import './styles.css';
import { renderLibrary } from './views/library.js';
import { renderEditor } from './views/editor.js';
import { renderPresenter } from './views/presenter.js';
import { renderAudience } from './views/audience.js';

const root = document.getElementById('app');
let cleanup = null;

function go(path) {
  location.hash = `#${path}`;
}

async function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);

  if (cleanup) {
    try {
      cleanup();
    } catch {
      /* abaikan */
    }
    cleanup = null;
  }
  document.body.dataset.view = parts[0] || 'library';
  try {
    if (parts[0] === 'audience') cleanup = renderAudience(root);
    else if (parts[0] === 'edit' && parts[1]) cleanup = await renderEditor(root, go, parts[1]);
    else if (parts[0] === 'present' && parts[1]) cleanup = await renderPresenter(root, go, parts[1], query);
    else cleanup = await renderLibrary(root, go);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="missing"><p>Terjadi kesalahan: ${String(err.message).replace(/</g, '&lt;')}</p><a class="btn" href="#/">Kembali ke daftar</a></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

/* ---------- pemberitahuan versi baru ---------- */

function showUpdate(s) {
  if (!s) return;
  let bar = document.getElementById('update-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.setAttribute('role', 'status');
    document.body.append(bar);
  }
  const v = String(s.version).replace(/[^\d.]/g, '');
  if (s.state === 'downloading') {
    bar.innerHTML = `<span>Mengunduh Sorot versi ${v} di latar belakang…</span>`;
  } else if (s.state === 'ready') {
    bar.innerHTML = `<span>Sorot versi ${v} siap dipasang.</span><button class="btn sm primary" data-u="install">Pasang dan mulai ulang</button><button class="btn sm ghost" data-u="later">Nanti saja</button>`;
  } else if (s.state === 'portable') {
    bar.innerHTML = `<span>Sorot versi ${v} tersedia.</span><button class="btn sm primary" data-u="open">Unduh</button><button class="btn sm ghost" data-u="later">Nanti saja</button>`;
  }
  bar.onclick = (e) => {
    const act = e.target.closest('[data-u]')?.dataset.u;
    if (act === 'install') window.sorot.installUpdate();
    else if (act === 'open') window.sorot.openExternal(s.url);
    if (act === 'later' || act === 'open') bar.remove();
  };
}

if (window.sorot?.onUpdate) {
  window.sorot.onUpdate(showUpdate);
  window.sorot.lastUpdate().then(showUpdate);
}
