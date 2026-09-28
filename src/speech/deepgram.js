// Pengenal suara cloud Deepgram Nova-3: suara dialirkan terus lewat WebSocket,
// hasil sementara (interim) datang ±0,3 detik setelah diucapkan.
import { VoiceFollower } from './recognizer.js';

const LANG = { indonesian: 'id', english: 'en' };

const STOPWORDS = new Set(
  'yang dan di ke dari untuk dengan pada ini itu adalah akan kami kita saya anda bapak ibu juga atau tidak dalam oleh sebagai karena agar supaya sudah telah masih bisa dapat ada para serta setiap semua lebih sangat hanya tersebut seperti namun tetapi jika bila maka sehingga bahwa kepada terhadap antara the and for with that this are was were have has will you your our from into'.split(
    ' ',
  ),
);

/**
 * Kata-kata khas naskah untuk "keyterm prompting": kata panjang atau nama diri
 * yang paling sering salah dikenali. Dibatasi agar tetap di bawah 500 token.
 */
export function pickKeyterms(words, max = 60) {
  const count = new Map();
  for (const w of words) {
    const raw = w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const norm = w.norm;
    if (norm.length < 5 || STOPWORDS.has(norm) || /^\d+$/.test(norm)) continue;
    const e = count.get(norm) || { text: raw, n: 0, proper: false };
    e.n++;
    if (/^\p{Lu}/u.test(raw)) e.proper = true;
    count.set(norm, e);
  }
  return [...count.values()]
    .sort((a, b) => Number(b.proper) - Number(a.proper) || b.text.length - a.text.length || b.n - a.n)
    .slice(0, max)
    .map((e) => e.text);
}

export class DeepgramFollower extends VoiceFollower {
  constructor({ apiKey, keyterms = [], ...rest }) {
    super(rest);
    this.apiKey = apiKey;
    this.keyterms = keyterms;
    this.finalWords = [];
    this.streamStart = 0;
    this.pending = [];
  }

  url() {
    const p = new URLSearchParams({
      model: 'nova-3',
      language: LANG[this.language] || 'id',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      punctuate: 'false',
      smart_format: 'false',
      endpointing: '300',
    });
    for (const k of this.keyterms) p.append('keyterm', k);
    return `wss://api.deepgram.com/v1/listen?${p}`;
  }

  // Menggantikan perulangan Whisper dengan koneksi WebSocket.
  loop() {
    this.connected = this.connect();
  }

  async start() {
    await super.start();
    await this.connected;
    if (this.ws?.readyState !== 1) throw new Error('Tidak bisa tersambung ke Deepgram. Periksa API key dan koneksi internet.');
  }

  connect(retry = 0) {
    return new Promise((resolve) => {
      let opened = false;
      const ws = new WebSocket(this.url(), ['token', this.apiKey]);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        opened = true;
        this.streamStart = performance.now();
        for (const buf of this.pending) ws.send(buf);
        this.pending = [];
        this.keepAlive = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'KeepAlive' })), 8000);
        resolve();
      };
      ws.onmessage = (e) => this.onResult(e.data);
      ws.onclose = (e) => {
        clearInterval(this.keepAlive);
        if (!this.running) return;
        // Bila ditolak saat membuka, coba sekali lagi tanpa daftar kata petunjuk.
        if (!opened && this.keyterms.length) {
          this.keyterms = [];
          this.connect(retry).then(resolve);
          return;
        }
        if (!opened || e.code === 1008 || e.code === 4001 || e.code === 4003) {
          const msg =
            e.code === 1008 || e.code === 4001 || e.code === 4003 || !opened
              ? 'Tidak bisa tersambung ke Deepgram. Periksa API key dan koneksi internet.'
              : `Koneksi Deepgram terputus (${e.code}).`;
          this.emit('error', { message: msg, fatal: true });
          resolve();
          return;
        }
        // Putus di tengah jalan: sambung ulang, paling banyak 5 kali berturut-turut.
        if (retry < 5) setTimeout(() => this.running && this.connect(retry + 1), 500 * (retry + 1));
        else this.emit('error', { message: 'Koneksi Deepgram terputus berulang kali.', fatal: true });
      };
    });
  }

  onChunk(chunk) {
    super.onChunk(chunk);
    const pcm = new Int16Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    if (this.ws?.readyState === 1) this.ws.send(pcm.buffer);
    else if (this.pending.length < 50) this.pending.push(pcm.buffer);
  }

  onResult(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type !== 'Results') return;
    const alt = msg.channel?.alternatives?.[0];
    const words = (alt?.words || []).map((w) => w.word);
    if (msg.is_final) {
      this.finalWords.push(...words);
      if (this.finalWords.length > 40) this.finalWords = this.finalWords.slice(-40);
    }
    const text = [...this.finalWords.slice(-12), ...(msg.is_final ? [] : words)].join(' ');
    if (!words.length && !msg.is_final) return;
    // Waktu kata terakhir diucapkan, dalam jam performance.now().
    const spokenAt = this.streamStart + ((msg.start || 0) + (msg.duration || 0)) * 1000;
    const sentAt = Math.min(performance.now(), spokenAt);
    this.emit('heard', { text, ms: 0, sentAt, latency: performance.now() - sentAt });
  }

  async stop() {
    this.running = false;
    clearInterval(this.keepAlive);
    try {
      if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws?.close();
    } catch {
      /* sudah tertutup */
    }
    await super.stop();
  }
}
