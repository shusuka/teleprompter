// Mengubah catatan menjadi deretan kata dan mencocokkan ucapan dengan naskah.

const CUE = /\[([^\]\n]{1,40})\]/g;

export function normalizeWord(w) {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Hasil: { slides: [{ index, paragraphs: [[token]] }], words: [{ norm, slide, text }] }
 * token: { type: 'word', text, wi } | { type: 'cue', text }
 */
export function tokenize(notesList) {
  const words = [];
  const slides = notesList.map((notes, index) => {
    const paragraphs = [];
    const blocks = String(notes || '')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n|\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const block of blocks) {
      const tokens = [];
      let last = 0;
      const pushWords = (chunk) => {
        for (const raw of chunk.split(/\s+/)) {
          if (!raw) continue;
          const norm = normalizeWord(raw);
          if (!norm) {
            // tanda baca lepas (mis. "—") ditempel ke token sebelumnya
            const prev = tokens[tokens.length - 1];
            if (prev && prev.type === 'word') prev.text += ` ${raw}`;
            continue;
          }
          const wi = words.length;
          words.push({ norm, slide: index, text: raw });
          tokens.push({ type: 'word', text: raw, wi });
        }
      };
      block.replace(CUE, (m, cue, offset) => {
        pushWords(block.slice(last, offset));
        tokens.push({ type: 'cue', text: cue.trim() });
        last = offset + m.length;
        return m;
      });
      pushWords(block.slice(last));
      if (tokens.length) paragraphs.push(tokens);
    }
    return { index, paragraphs };
  });
  return { slides, words };
}

export function countWords(notes) {
  return tokenize([notes]).words.length;
}

/* ---------- kemiripan kata ---------- */

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

export function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const short = Math.min(a.length, b.length);
  if (short <= 2) return 0;
  if (short >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.85;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const MATCH_MIN = 0.7;

/**
 * Mencari posisi di naskah yang paling cocok dengan ekor ucapan terakhir.
 * Pencarian lokal (Smith–Waterman) di jendela sekitar posisi sekarang,
 * dengan sedikit hukuman untuk lompatan jauh ke depan.
 *
 * @returns {{ index: number, score: number } | null} index = kata naskah terakhir yang terucap
 */
export function alignHeard(words, pointer, heardNorm, { back = 4, ahead = 40 } = {}) {
  const heard = heardNorm.filter(Boolean).slice(-10);
  if (!heard.length || !words.length) return null;
  const start = Math.max(0, pointer - back);
  const end = Math.min(words.length, pointer + ahead);
  const cols = end - start;
  if (cols <= 0) return null;

  const GAP_SCRIPT = 0.55; // naskah dilewati pembicara
  const GAP_HEARD = 0.7; // kata tambahan yang tidak ada di naskah
  const rows = heard.length;
  let prev = new Float32Array(cols + 1);
  let cur = new Float32Array(cols + 1);
  const matches = new Uint8Array(cols + 1);
  let prevMatches = new Uint8Array(cols + 1);
  let best = null;

  for (let i = 1; i <= rows; i++) {
    cur[0] = 0;
    matches[0] = 0;
    for (let j = 1; j <= cols; j++) {
      const sim = wordSimilarity(heard[i - 1], words[start + j - 1].norm);
      const isMatch = sim >= MATCH_MIN;
      const diag = prev[j - 1] + (isMatch ? 1 + sim : -0.9);
      const up = prev[j] - GAP_HEARD;
      const left = cur[j - 1] - GAP_SCRIPT;
      let v = 0;
      let mc = 0;
      if (diag >= up && diag >= left && diag > 0) {
        v = diag;
        mc = prevMatches[j - 1] + (isMatch ? 1 : 0);
      } else if (up >= left && up > 0) {
        v = up;
        mc = prevMatches[j];
      } else if (left > 0) {
        v = left;
        mc = matches[j - 1];
      }
      cur[j] = v;
      matches[j] = mc;
      // Hanya titik akhir yang benar-benar cocok yang dihitung, dan hanya bila
      // ucapan itu termasuk bagian paling akhir (≤2 kata dari ujung).
      if (isMatch && i >= rows - 2) {
        const idx = start + j - 1;
        const jump = Math.max(0, idx - pointer);
        const score = v - jump * 0.04 - (rows - i) * 0.6;
        const enough = mc >= 2 || (mc === 1 && words[idx].norm.length >= 6 && sim >= 0.9 && jump <= 6);
        if (enough && (!best || score > best.score)) best = { index: idx, score, matched: mc };
      }
    }
    [prev, cur] = [cur, prev];
    prevMatches = Uint8Array.from(matches);
  }
  return best;
}

export function wordsToNorm(text) {
  return String(text || '')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}
