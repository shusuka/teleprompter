import { store, slideUrls, isDesktop, desktopApi } from '../store.js';
import { tokenize, alignHeard, wordsToNorm } from '../script.js';
import { loadSettings, saveSettings } from '../settings.js';
import { VoiceFollower, loadModel, modelLoaded, loadedDevice, listMics, MODELS, LANGUAGES, DEVICES } from '../speech/recognizer.js';
import { icon } from '../icons.js';
import { esc, el, $, $$, formatDuration, toast, prefersReducedMotion } from '../util.js';

const CHANNEL = 'sorot-audience';

export async function renderPresenter(root, go, id, query) {
  root.innerHTML = '<div class="lib-loading">Memuat paparan…</div>';
  const project = await store.get(id).catch(() => null);
  if (!project) {
    root.innerHTML = '';
    root.append(el(`<div class="missing"><p>Paparan tidak ditemukan.</p><a class="btn" href="#/">Kembali ke daftar</a></div>`));
    return;
  }
  const urls = await slideUrls(project);
  const settings = loadSettings();
  const script = tokenize(project.slides.map((s) => s.notes));
  const words = script.words;
  const N = words.length;
  const slideCount = project.slides.length;

  // indeks kata pertama tiap slide (atau kata pertama sesudahnya bila slide tanpa naskah)
  const firstWord = new Array(slideCount).fill(N);
  for (let i = N - 1; i >= 0; i--) firstWord[words[i].slide] = i;
  for (let s = slideCount - 2; s >= 0; s--) firstWord[s] = Math.min(firstWord[s], firstWord[s + 1]);

  /* ---------- kerangka ---------- */

  const view = el(`
    <div class="stage" data-layout="${settings.layout}">
      <header class="pbar">
        <button class="btn icon-only ghost" data-act="back" aria-label="Keluar dari paparan" title="Keluar (Esc dua kali)">${icon('back')}</button>
        <div class="seg" role="radiogroup" aria-label="Cara naskah bergerak">
          <button role="radio" data-mode="voice" title="Naskah mengikuti suara Anda">${icon('mic', 16)}<span>Suara</span></button>
          <button role="radio" data-mode="auto" title="Naskah bergerak dengan kecepatan tetap">${icon('play', 16)}<span>Otomatis</span></button>
          <button role="radio" data-mode="manual" title="Gerakkan sendiri dengan tombol panah">${icon('keyboard', 16)}<span>Manual</span></button>
        </div>
        <button class="btn run" data-act="run"></button>
        <div class="meter" aria-hidden="true"><span></span></div>
        <p class="heard" aria-live="off"></p>
        <div class="spacer"></div>
        <div class="slide-nav" role="group" aria-label="Navigasi slide">
          <button class="btn icon-only ghost" data-act="prev" aria-label="Slide sebelumnya" title="Slide sebelumnya (←)">${icon('chevLeft')}</button>
          <span class="slide-count" aria-live="polite"></span>
          <button class="btn icon-only ghost" data-act="next" aria-label="Slide berikutnya" title="Slide berikutnya (→)">${icon('chevRight')}</button>
        </div>
        <button class="timer" data-act="timer" title="Klik untuk mengulang waktu">${icon('clock', 16)}<span>0:00</span></button>
        <span class="clock" aria-hidden="true"></span>
        <button class="btn icon-only ghost" data-act="audience" aria-label="Layar penonton" title="Tampilkan slide di layar kedua / proyektor">${icon('monitor')}</button>
        <button class="btn icon-only ghost" data-act="fullscreen" aria-label="Layar penuh" title="Layar penuh (F)">${icon('maximize')}</button>
        <button class="btn icon-only ghost" data-act="settings" aria-label="Pengaturan" aria-expanded="false" title="Pengaturan">${icon('settings')}</button>
      </header>

      <section class="slide-pane" aria-label="Slide">
        <img class="slide-img" alt="" draggable="false" />
        <div class="blackout-badge" hidden>Layar penonton gelap · tekan B</div>
        <aside class="next-slide" aria-label="Slide berikutnya"><span>Berikutnya</span><img alt="" draggable="false" /></aside>
      </section>

      <div class="divider" role="separator" aria-orientation="horizontal" aria-label="Geser untuk mengubah ukuran slide" tabindex="0"><span></span></div>

      <section class="prompter" aria-label="Naskah">
        <div class="reading-line" aria-hidden="true"><i></i><i></i></div>
        <div class="prompter-viewport">
          <div class="prompter-move"><div class="prompter-text"></div></div>
        </div>
        <div class="prompter-note" hidden></div>
        <div class="progress" aria-hidden="true"><span></span></div>
      </section>

      <aside class="drawer" aria-label="Pengaturan" hidden></aside>
    </div>`);
  root.innerHTML = '';
  root.append(view);

  const slideImg = $('.slide-img', view);
  const nextBox = $('.next-slide', view);
  const nextImg = $('img', nextBox);
  const slideCountEl = $('.slide-count', view);
  const textBox = $('.prompter-text', view);
  const mover = $('.prompter-move', view);
  const viewport = $('.prompter-viewport', view);
  const note = $('.prompter-note', view);
  const heardEl = $('.heard', view);
  const meter = $('.meter span', view);
  const runBtn = $('[data-act="run"]', view);
  const drawer = $('.drawer', view);
  const progressBar = $('.progress span', view);

  /* ---------- naskah ---------- */

  const wordEls = new Array(N);
  const pauseBefore = new Uint8Array(N);
  const sectionEls = [];
  const frag = document.createDocumentFragment();
  for (const sl of script.slides) {
    const sec = el(`<section class="p-slide" data-slide="${sl.index}"><h3 class="p-chip">Slide ${sl.index + 1}</h3></section>`);
    if (!sl.paragraphs.length) sec.append(el('<p class="p-empty">Tidak ada naskah untuk slide ini.</p>'));
    let pendingPause = false;
    for (const para of sl.paragraphs) {
      const p = document.createElement('p');
      for (const tok of para) {
        if (tok.type === 'cue') {
          p.append(el(`<span class="cue">${esc(tok.text)}</span>`), ' ');
          if (/jeda|pause|berhenti|diam|tarik napas/i.test(tok.text)) pendingPause = true;
        } else {
          const s = document.createElement('span');
          s.className = 'w';
          s.dataset.i = tok.wi;
          s.textContent = tok.text;
          wordEls[tok.wi] = s;
          if (pendingPause) pauseBefore[tok.wi] = 1;
          pendingPause = false;
          p.append(s, ' ');
        }
      }
      sec.append(p);
    }
    sectionEls.push(sec);
    frag.append(sec);
  }
  frag.append(el('<p class="p-end">Selesai</p>'));
  textBox.append(frag);

  /* ---------- keadaan ---------- */

  const state = {
    display: 0,
    confirmed: 0,
    slide: 0,
    running: false,
    blackout: false,
    startedAt: 0,
    rate: 2.3, // kata per detik, diperbarui dari ucapan
    lastStep: 0,
    lastConfirmAt: 0,
    ahead: 0, // perkiraan kata yang sudah terucap sejak potongan suara terakhir dikirim
    lastTick: 0,
    moveY: null,
  };
  let follower = null;
  let destroyed = false;

  const applyTypography = () => {
    view.dataset.layout = settings.layout;
    view.style.setProperty('--split', settings.split);
    textBox.style.fontSize = `${settings.fontSize}px`;
    textBox.style.lineHeight = settings.lineHeight;
    textBox.style.width = `${settings.textWidth}%`;
    textBox.classList.toggle('mirror', settings.mirror);
    view.style.setProperty('--reading', settings.readingLine);
    $('.clock', view).hidden = !settings.showClock;
  };

  const persistSettings = () => saveSettings(settings);

  function scrollToCurrent(instant = false) {
    const target = wordEls[Math.min(state.display, N - 1)] || textBox.querySelector('.p-end');
    let top;
    if (N === 0) top = 0;
    else if (state.display >= N) top = textBox.querySelector('.p-end').offsetTop;
    else {
      const w = words[state.display];
      // slide tanpa naskah: tampilkan penanda slidenya di garis baca
      if (w.slide > state.slide && !project.slides[state.slide].notes.trim()) top = sectionEls[state.slide].offsetTop;
      else top = target.offsetTop;
    }
    const y = Math.round(viewport.clientHeight * settings.readingLine - top - settings.fontSize * 0.12);
    if (state.moveY === y) return;
    state.moveY = y;
    mover.style.transition = instant || prefersReducedMotion() ? 'none' : '';
    mover.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  function setDisplay(i, { reading = false, instant = false } = {}) {
    i = Math.max(0, Math.min(N, i));
    const old = state.display;
    if (i > old) for (let k = old; k < i; k++) wordEls[k].classList.add('done');
    else if (i < old) for (let k = i; k < old && k < N; k++) wordEls[k].classList.remove('done');
    wordEls[old]?.classList.remove('cur');
    wordEls[i]?.classList.add('cur');
    state.display = i;
    if (reading && i > old && settings.autoSlide && i > 0) {
      const spokenSlide = words[i - 1].slide;
      if (spokenSlide > state.slide) showSlide(spokenSlide, { moveText: false });
    }
    progressBar.style.transform = `scaleX(${N ? i / N : 0})`;
    scrollToCurrent(instant);
  }

  function resync(i) {
    state.confirmed = i;
    state.lastConfirmAt = performance.now();
    setDisplay(i);
  }

  /* ---------- slide & layar penonton ---------- */

  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(CHANNEL) : null;
  const broadcast = () =>
    channel?.postMessage({ type: 'slide', url: urls[state.slide] || '', black: state.blackout, aspect: project.aspect, title: project.title });
  if (channel) channel.onmessage = (e) => e.data?.type === 'hello' && broadcast();

  function showSlide(n, { moveText = true } = {}) {
    n = Math.max(0, Math.min(slideCount - 1, n));
    state.slide = n;
    slideImg.src = urls[n] || '';
    slideImg.alt = `Slide ${n + 1}`;
    slideCountEl.textContent = `${n + 1} / ${slideCount}`;
    const nx = urls[n + 1];
    nextBox.hidden = !nx;
    if (nx) nextImg.src = nx;
    sectionEls.forEach((s, k) => s.classList.toggle('active', k === n));
    if (nx) new Image().src = nx; // pramuat
    broadcast();
    if (moveText) resync(firstWord[n]);
  }

  /* ---------- mode & jalan ---------- */

  function setMode(mode) {
    if (settings.mode === mode) return;
    stopRunning();
    settings.mode = mode;
    persistSettings();
    renderModeUi();
  }

  function renderModeUi() {
    $$('.seg [data-mode]', view).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
    const m = settings.mode;
    view.dataset.mode = m;
    if (m === 'manual') {
      runBtn.hidden = true;
    } else {
      runBtn.hidden = false;
      const label = state.running ? (m === 'voice' ? 'Berhenti mendengar' : 'Jeda') : m === 'voice' ? 'Mulai mendengar' : 'Mulai jalan';
      runBtn.innerHTML = `${icon(state.running ? (m === 'voice' ? 'micOff' : 'pause') : m === 'voice' ? 'mic' : 'play', 16)}<span>${label}</span>`;
      runBtn.classList.toggle('primary', !state.running);
      runBtn.classList.toggle('live', state.running);
    }
    $('.meter', view).hidden = m !== 'voice';
    heardEl.hidden = m !== 'voice';
  }

  function showNote(html, kind = 'info') {
    if (!html) {
      note.hidden = true;
      return;
    }
    note.innerHTML = html;
    note.dataset.kind = kind;
    note.hidden = false;
  }

  function startClock() {
    if (!state.startedAt) state.startedAt = Date.now();
  }

  async function startRunning() {
    if (state.running || N === 0) {
      if (N === 0) toast('Belum ada naskah. Tambahkan lewat penyunting.', 'warn');
      return;
    }
    if (settings.mode === 'voice') {
      runBtn.disabled = true;
      try {
        if (!modelLoaded(settings.model, settings.device)) {
          const m = MODELS.find((x) => x.id === settings.model) || MODELS[1];
          showNote(`<strong>Menyiapkan pengenal suara</strong><span>Model ${esc(m.label)} (${m.size}) diunduh sekali saja lalu tersimpan di komputer.</span><progress max="1" value="0"></progress><small></small>`);
          await loadModel(
            settings.model,
            (p, label) => {
              const pr = note.querySelector('progress');
              if (pr) pr.value = p;
              const sm = note.querySelector('small');
              if (sm) sm.textContent = label;
            },
            settings.device,
          );
          if (destroyed) return;
        }
        follower = new VoiceFollower({ model: settings.model, language: settings.language, deviceId: settings.micId });
        follower.addEventListener('heard', onHeard);
        follower.addEventListener('level', onLevel);
        follower.addEventListener('error', (e) => toast(`Pengenal suara: ${e.detail.message}`, 'error'));
        await follower.start();
        state.confirmed = state.display;
        state.ahead = 0;
        showNote('');
      } catch (err) {
        follower = null;
        runBtn.disabled = false;
        const msg = String(err?.message || err);
        if (/Permission|NotAllowed|denied/i.test(msg)) showNote('<strong>Mikrofon tidak diizinkan.</strong><span>Izinkan akses mikrofon untuk Sorot di Pengaturan Windows › Privasi › Mikrofon, lalu coba lagi.</span>', 'error');
        else if (/NotFound|Requested device/i.test(msg)) showNote('<strong>Mikrofon tidak ditemukan.</strong><span>Sambungkan mikrofon atau pilih perangkat lain di Pengaturan.</span>', 'error');
        else if (/fetch|network|Failed to load|404/i.test(msg)) showNote('<strong>Model belum bisa diunduh.</strong><span>Unduhan pertama butuh internet. Sambungkan internet lalu coba lagi, atau pakai mode Otomatis/Manual.</span>', 'error');
        else showNote(`<strong>Pengenal suara gagal dimulai.</strong><span>${esc(msg)}</span>`, 'error');
        return;
      }
      runBtn.disabled = false;
    }
    state.running = true;
    state.lastStep = performance.now();
    startClock();
    renderModeUi();
  }

  function stopRunning() {
    state.running = false;
    if (follower) {
      follower.stop();
      follower = null;
    }
    meter.style.transform = 'scaleX(0)';
    view.classList.remove('speaking');
    renderModeUi();
  }

  function onLevel(e) {
    const { rms, speaking } = e.detail;
    meter.style.transform = `scaleX(${Math.min(1, rms * 14)})`;
    view.classList.toggle('speaking', speaking);
  }

  function onHeard(e) {
    const { text, sentAt, latency } = e.detail;
    const dev = loadedDevice() === 'webgpu' ? 'GPU' : 'CPU';
    heardEl.innerHTML = `<b>${(latency / 1000).toFixed(1).replace('.', ',')} dtk · ${dev}</b> ${esc(text.slice(-64))}`;
    heardEl.title = 'Jeda pengenalan suara. Bila selalu di atas 2 detik, pilih model Cepat di Pengaturan.';
    if (!text) return;
    const r = alignHeard(words, state.confirmed, wordsToNorm(text));
    if (!r) return;
    const next = r.index + 1;
    if (next <= state.confirmed) return;
    const now = performance.now();
    const dt = (now - state.lastConfirmAt) / 1000;
    const dw = next - state.confirmed;
    if (state.lastConfirmAt && dt > 0.3 && dt < 6 && dw < 25) {
      const inst = Math.min(4.2, Math.max(1.1, dw / dt));
      state.rate = state.rate * 0.7 + inst * 0.3;
    }
    state.confirmed = next;
    state.lastConfirmAt = now;
    // Potongan suara dikirim `latency` ms lalu; selama itu pembicara sudah maju beberapa kata lagi.
    state.ahead = (state.rate * (now - sentAt)) / 1000;
    if (next > state.display) {
      setDisplay(next, { reading: true });
      state.lastStep = now;
    }
  }

  function wordDuration(i) {
    const w = words[i];
    const base = 60000 / settings.wpm;
    const len = w.norm.length;
    let f = 0.55 + len * 0.075;
    if (/[.!?…]["')\]]*$/.test(w.text)) f += 0.9;
    else if (/[,;:]["')\]]*$/.test(w.text)) f += 0.35;
    return base * Math.min(2.4, Math.max(0.6, f));
  }

  let raf = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = state.lastTick ? Math.min(0.25, (now - state.lastTick) / 1000) : 0;
    state.lastTick = now;
    if (!state.running || state.display >= N) {
      if (state.running && state.display >= N && settings.mode === 'auto') stopRunning();
      return;
    }
    if (settings.mode === 'auto') {
      const need = wordDuration(state.display) + (pauseBefore[state.display + 1] ? 1200 : 0);
      if (now - state.lastStep >= need) {
        state.lastStep = now;
        setDisplay(state.display + 1, { reading: true });
      }
    } else if (settings.mode === 'voice' && follower) {
      // Hasil pengenalan selalu sedikit terlambat. Selama Anda bicara, sorotan maju
      // mengikuti kecepatan bicara Anda (paling jauh 6 kata di depan hasil terakhir),
      // lalu dikoreksi setiap hasil baru datang.
      if (follower.isSpeaking()) {
        state.ahead += state.rate * dt;
        const allowed = Math.min(N, state.confirmed + Math.min(6, Math.floor(state.ahead)));
        if (state.display < allowed && now - state.lastStep >= 1000 / (state.rate * 1.25)) {
          state.lastStep = now;
          setDisplay(state.display + 1, { reading: true });
        }
      } else {
        state.lastStep = now;
      }
    }
  }
  raf = requestAnimationFrame(tick);

  /* ---------- garis ---------- */

  function lineStep(dir) {
    if (!N) return;
    const cur = wordEls[Math.min(state.display, N - 1)];
    const top = cur.offsetTop;
    if (dir > 0) {
      for (let k = state.display + 1; k < N; k++) {
        if (wordEls[k].offsetTop > top + 2) return resync(k);
      }
      resync(N);
    } else {
      let k = Math.min(state.display, N) - 1;
      while (k >= 0 && wordEls[k].offsetTop >= top - 2) k--;
      if (k < 0) return resync(0);
      const prevTop = wordEls[k].offsetTop;
      while (k > 0 && wordEls[k - 1].offsetTop >= prevTop - 2) k--;
      resync(k);
    }
  }

  /* ---------- pengaturan ---------- */

  async function renderDrawer() {
    const mics = await listMics();
    const rangeRow = (key, label, min, max, step, fmt) => `
      <label class="range"><span>${label}<output>${fmt(settings[key])}</output></span>
        <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}" /></label>`;
    drawer.innerHTML = `
      <header><h2>Pengaturan</h2><button class="btn icon-only ghost" data-act="close-drawer" aria-label="Tutup pengaturan">${icon('x')}</button></header>
      <div class="drawer-body">
        <fieldset><legend>Tata letak</legend>
          <div class="seg full" role="radiogroup" aria-label="Posisi prompter">
            <button role="radio" data-layout="top" aria-checked="${settings.layout === 'top'}">Naskah di atas, dekat kamera</button>
            <button role="radio" data-layout="bottom" aria-checked="${settings.layout === 'bottom'}">Naskah di bawah slide</button>
          </div>
          <p class="help">Dengan naskah di atas, mata Anda tetap dekat webcam sehingga tatapan terlihat lurus ke kamera. Geser garis pemisah untuk mengatur tinggi naskah dan slide.</p>
          ${rangeRow('fontSize', 'Ukuran huruf', 24, 110, 2, (v) => `${v}px`)}
          ${rangeRow('lineHeight', 'Jarak baris', 1.15, 2.2, 0.05, (v) => Number(v).toFixed(2))}
          ${rangeRow('textWidth', 'Lebar naskah', 40, 100, 2, (v) => `${v}%`)}
          ${rangeRow('readingLine', 'Posisi garis baca', 0.12, 0.7, 0.02, (v) => `${Math.round(v * 100)}%`)}
          <label class="check"><input type="checkbox" data-key="mirror" ${settings.mirror ? 'checked' : ''}/><span>Cerminkan naskah (untuk kaca teleprompter)</span></label>
          <label class="check"><input type="checkbox" data-key="showClock" ${settings.showClock ? 'checked' : ''}/><span>Tampilkan jam</span></label>
        </fieldset>
        <fieldset><legend>Gerak naskah</legend>
          <label class="check"><input type="checkbox" data-key="autoSlide" ${settings.autoSlide ? 'checked' : ''}/><span>Pindah slide otomatis saat naskah slide berikutnya mulai dibaca</span></label>
          ${rangeRow('wpm', 'Kecepatan mode Otomatis', 60, 220, 5, (v) => `${v} kata/menit`)}
        </fieldset>
        <fieldset><legend>Pengenal suara</legend>
          <label class="field"><span class="label">Mikrofon</span>
            <select data-key="micId"><option value="">Bawaan sistem</option>${mics
              .map((m, i) => `<option value="${esc(m.deviceId)}" ${m.deviceId === settings.micId ? 'selected' : ''}>${esc(m.label || `Mikrofon ${i + 1}`)}</option>`)
              .join('')}</select></label>
          <label class="field"><span class="label">Bahasa naskah</span>
            <select data-key="language">${LANGUAGES.map((l) => `<option value="${l.id}" ${l.id === settings.language ? 'selected' : ''}>${l.label}</option>`).join('')}</select></label>
          <label class="field"><span class="label">Pemroses</span>
            <select data-key="device">${DEVICES.map((d) => `<option value="${d.id}" ${d.id === settings.device ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
          <div class="field"><span class="label">Model</span>
            <div class="models" role="radiogroup" aria-label="Model pengenal suara">${MODELS.map(
              (m) => `<button role="radio" data-model="${m.id}" aria-checked="${m.id === settings.model}"><strong>${m.label}</strong><span>${m.size} · ${m.note}</span></button>`,
            ).join('')}</div></div>
          <button class="btn ghost full" data-act="preload">Unduh model sekarang (agar siap tanpa internet)</button>
          <p class="help">Suara diolah di komputer ini. Internet hanya dipakai sekali untuk mengunduh model.</p>
        </fieldset>
        <fieldset><legend>Pintasan</legend>
          <dl class="keys">
            <dt><kbd>Spasi</kbd></dt><dd>Mulai / berhenti</dd>
            <dt><kbd>→</kbd> <kbd>PgDn</kbd></dt><dd>Slide berikutnya</dd>
            <dt><kbd>←</kbd> <kbd>PgUp</kbd></dt><dd>Slide sebelumnya</dd>
            <dt><kbd>↓</kbd> <kbd>↑</kbd></dt><dd>Maju / mundur satu baris</dd>
            <dt>Klik kata</dt><dd>Lompat ke kata itu</dd>
            <dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>Ukuran huruf</dd>
            <dt><kbd>B</kbd></dt><dd>Gelapkan layar penonton</dd>
            <dt><kbd>F</kbd></dt><dd>Layar penuh</dd>
            <dt><kbd>Home</kbd></dt><dd>Kembali ke awal naskah</dd>
          </dl>
        </fieldset>
      </div>`;

    $('[data-act="close-drawer"]', drawer).onclick = () => toggleDrawer(false);
    $$('input[type="range"]', drawer).forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.key;
        settings[key] = Number(inp.value);
        const out = inp.parentElement.querySelector('output');
        out.textContent =
          key === 'fontSize' ? `${inp.value}px` : key === 'lineHeight' ? Number(inp.value).toFixed(2) : key === 'textWidth' ? `${inp.value}%` : key === 'readingLine' ? `${Math.round(inp.value * 100)}%` : `${inp.value} kata/menit`;
        applyTypography();
        state.moveY = null;
        scrollToCurrent(true);
        persistSettings();
      });
    });
    $$('input[type="checkbox"]', drawer).forEach((inp) => {
      inp.addEventListener('change', () => {
        settings[inp.dataset.key] = inp.checked;
        applyTypography();
        persistSettings();
      });
    });
    $$('select', drawer).forEach((sel) => {
      sel.addEventListener('change', () => {
        settings[sel.dataset.key] = sel.value;
        persistSettings();
        if (follower) {
          stopRunning();
          toast('Pengaturan suara berubah. Tekan Mulai mendengar lagi.');
        }
      });
    });
    $$('[data-layout]', drawer).forEach((b) => {
      b.onclick = () => {
        settings.layout = b.dataset.layout;
        $$('[data-layout]', drawer).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        applyTypography();
        persistSettings();
        requestAnimationFrame(() => {
          state.moveY = null;
          scrollToCurrent(true);
        });
      };
    });
    $$('[data-model]', drawer).forEach((b) => {
      b.onclick = () => {
        settings.model = b.dataset.model;
        $$('[data-model]', drawer).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        persistSettings();
        if (follower) {
          stopRunning();
          toast('Model diganti. Tekan Mulai mendengar lagi.');
        }
      };
    });
    $('[data-act="preload"]', drawer).onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await loadModel(settings.model, (p, label) => (btn.textContent = `Mengunduh… ${Math.round(p * 100)}% ${label}`), settings.device);
        btn.textContent = 'Model siap dipakai';
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Gagal mengunduh — coba lagi';
        toast(`Gagal mengunduh model: ${err.message}`, 'error');
      }
    };
  }

  function toggleDrawer(open) {
    const willOpen = open ?? drawer.hidden;
    const btn = $('[data-act="settings"]', view);
    btn.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      renderDrawer().then(() => {
        drawer.hidden = false;
        drawer.querySelector('button, input, select')?.focus();
      });
    } else {
      drawer.hidden = true;
      btn.focus();
    }
  }

  /* ---------- tombol & keyboard ---------- */

  const toggleBlackout = () => {
    state.blackout = !state.blackout;
    $('.blackout-badge', view).hidden = !state.blackout;
    broadcast();
  };

  const fullscreen = async () => {
    if (isDesktop) await desktopApi.toggleFullscreen();
    else if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
    setTimeout(() => {
      state.moveY = null;
      scrollToCurrent(true);
    }, 250);
  };

  let audienceOpen = false;
  const syncAudienceBtn = () => $('[data-act="audience"]', view).classList.toggle('on', audienceOpen);
  const offAudience = isDesktop ? desktopApi.onAudienceClosed(() => ((audienceOpen = false), syncAudienceBtn())) : () => {};
  if (isDesktop) desktopApi.isAudienceOpen().then((v) => ((audienceOpen = v), syncAudienceBtn()));
  let webAudience = null;
  const toggleAudience = async () => {
    if (isDesktop) {
      if (audienceOpen) {
        await desktopApi.closeAudience();
        audienceOpen = false;
      } else {
        const r = await desktopApi.openAudience();
        audienceOpen = true;
        if (!r.external) toast('Hanya satu layar terdeteksi. Jendela penonton dibuka sebagai jendela biasa; sambungkan proyektor lalu buka ulang untuk layar penuh di sana.', 'info', 7000);
      }
      syncAudienceBtn();
      setTimeout(broadcast, 400);
    } else {
      if (webAudience && !webAudience.closed) webAudience.close();
      else webAudience = window.open(`${location.pathname}#/audience`, 'sorot-audience', 'width=960,height=540');
    }
  };

  const leave = () => go(`/edit/${project.id}`);

  view.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act], [data-mode]');
    if (b?.dataset.mode) return setMode(b.dataset.mode);
    const w = e.target.closest('.w');
    if (w) {
      resync(Number(w.dataset.i));
      return;
    }
    if (!b) return;
    switch (b.dataset.act) {
      case 'back':
        return leave();
      case 'run':
        return state.running ? stopRunning() : startRunning();
      case 'prev':
        return showSlide(state.slide - 1);
      case 'next':
        return showSlide(state.slide + 1);
      case 'timer':
        state.startedAt = state.running ? Date.now() : 0;
        return updateTimer();
      case 'audience':
        return toggleAudience();
      case 'fullscreen':
        return fullscreen();
      case 'settings':
        return toggleDrawer();
    }
  });

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      lineStep(e.deltaY > 0 ? 1 : -1);
    },
    { passive: false },
  );

  let lastEsc = 0;
  const onKey = (e) => {
    if (e.target.closest('input, select, textarea') && e.key !== 'Escape') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key;
    if (k === ' ' || k === 'Spacebar') {
      e.preventDefault();
      if (settings.mode === 'manual') lineStep(1);
      else state.running ? stopRunning() : startRunning();
    } else if (k === 'ArrowRight' || k === 'PageDown') {
      e.preventDefault();
      showSlide(state.slide + 1);
    } else if (k === 'ArrowLeft' || k === 'PageUp') {
      e.preventDefault();
      showSlide(state.slide - 1);
    } else if (k === 'ArrowDown') {
      e.preventDefault();
      lineStep(1);
    } else if (k === 'ArrowUp') {
      e.preventDefault();
      lineStep(-1);
    } else if (k === 'Home') {
      e.preventDefault();
      showSlide(0);
    } else if (k === '+' || k === '=') {
      settings.fontSize = Math.min(110, settings.fontSize + 2);
      applyTypography();
      state.moveY = null;
      scrollToCurrent(true);
      persistSettings();
    } else if (k === '-' || k === '_') {
      settings.fontSize = Math.max(24, settings.fontSize - 2);
      applyTypography();
      state.moveY = null;
      scrollToCurrent(true);
      persistSettings();
    } else if (k === 'b' || k === 'B' || k === '.') {
      toggleBlackout();
    } else if (k === 'f' || k === 'F' || k === 'F5') {
      e.preventDefault();
      fullscreen();
    } else if (k === 'Escape') {
      if (!drawer.hidden) return toggleDrawer(false);
      const now = Date.now();
      if (now - lastEsc < 700) leave();
      else toast('Tekan Esc sekali lagi untuk keluar dari paparan.', 'info', 1500);
      lastEsc = now;
    }
  };
  window.addEventListener('keydown', onKey);

  /* ---------- pembatas geser ---------- */

  const divider = $('.divider', view);
  divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    const bar = $('.pbar', view).getBoundingClientRect();
    const total = view.getBoundingClientRect().height - bar.height;
    const move = (ev) => {
      const y = ev.clientY - bar.bottom;
      let ratio = settings.layout === 'bottom' ? y / total : 1 - y / total;
      ratio = Math.max(0.18, Math.min(0.82, ratio));
      settings.split = ratio;
      view.style.setProperty('--split', ratio);
      state.moveY = null;
      scrollToCurrent(true);
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
      persistSettings();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowDown' ? 0.03 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    settings.split = Math.max(0.18, Math.min(0.82, settings.split + (settings.layout === 'bottom' ? d : -d)));
    applyTypography();
    state.moveY = null;
    scrollToCurrent(true);
    persistSettings();
  });

  const ro = new ResizeObserver(() => {
    state.moveY = null;
    scrollToCurrent(true);
  });
  ro.observe(viewport);

  /* ---------- waktu ---------- */

  const clockFmt = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
  function updateTimer() {
    const t = state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0;
    $('.timer span', view).textContent = formatDuration(t);
    $('.clock', view).textContent = clockFmt.format(new Date());
  }
  const timerId = setInterval(updateTimer, 500);
  updateTimer();

  /* ---------- mulai ---------- */

  applyTypography();
  renderModeUi();
  const startSlide = Math.max(0, Math.min(slideCount - 1, Number(query.get('slide') || 0)));
  showSlide(startSlide, { moveText: false });
  setDisplay(firstWord[startSlide] ?? 0, { instant: true });
  state.confirmed = state.display;
  if (!N) showNote('<strong>Belum ada naskah.</strong><span>Keluar lalu tulis atau impor naskah di penyunting.</span>', 'warn');
  document.fonts?.ready.then(() => {
    state.moveY = null;
    scrollToCurrent(true);
  });

  return () => {
    destroyed = true;
    stopRunning();
    cancelAnimationFrame(raf);
    clearInterval(timerId);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
    offAudience();
    channel?.close();
  };
}
