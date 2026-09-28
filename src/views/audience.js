import { el } from '../util.js';

// Layar penonton: hanya slide, tanpa naskah. Menerima perintah dari jendela narasumber.
export function renderAudience(root) {
  document.body.classList.add('audience-body');
  document.title = 'Sorot — Layar Penonton';
  root.innerHTML = '';
  const view = el(`
    <div class="audience">
      <img alt="" draggable="false" />
      <p class="audience-wait">Menunggu paparan dimulai…</p>
    </div>`);
  root.append(view);
  const img = view.querySelector('img');
  const wait = view.querySelector('.audience-wait');

  const ch = new BroadcastChannel('sorot-audience');
  ch.onmessage = (e) => {
    const m = e.data;
    if (m?.type !== 'slide') return;
    wait.hidden = true;
    view.classList.toggle('black', !!m.black);
    if (m.url && img.getAttribute('src') !== m.url) img.src = m.url;
    if (m.title) document.title = `${m.title} — Layar Penonton`;
  };
  ch.postMessage({ type: 'hello' });

  let t;
  const idle = () => {
    view.classList.remove('cursor');
    clearTimeout(t);
    view.classList.add('cursor');
    t = setTimeout(() => view.classList.remove('cursor'), 1500);
  };
  view.addEventListener('mousemove', idle);

  return () => {
    ch.close();
    document.body.classList.remove('audience-body');
  };
}
