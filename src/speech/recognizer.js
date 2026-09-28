// Mikrofon → deteksi suara → Whisper (di worker) → teks yang terdengar.

const RATE = 16000;
const WINDOW_S = 5;
const MIN_NEW_S = 0.45;
const HANGOVER_MS = 900;

export const MODELS = [
  { id: 'onnx-community/whisper-tiny', label: 'Cepat', size: '±45 MB', note: 'Paling ringan, akurasi cukup' },
  { id: 'onnx-community/whisper-base', label: 'Seimbang', size: '±95 MB', note: 'Disarankan untuk laptop umum' },
  { id: 'onnx-community/whisper-small', label: 'Akurat', size: '±300 MB', note: 'Butuh laptop kencang / GPU' },
];

export const DEVICES = [
  { id: 'auto', label: 'Otomatis' },
  { id: 'wasm', label: 'CPU' },
  { id: 'webgpu', label: 'GPU' },
];

export const LANGUAGES = [
  { id: 'indonesian', label: 'Bahasa Indonesia' },
  { id: 'english', label: 'English' },
];

let sharedWorker = null;
let loadState = { model: null, promise: null, device: null };

function worker() {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
  }
  return sharedWorker;
}

/** Memuat (dan mengunduh bila belum ada) model. onProgress(0..1, label). */
export function loadModel(model, onProgress, device = 'auto') {
  const key = `${model}|${device}`;
  if (loadState.model === key && loadState.promise) return loadState.promise;
  const w = worker();
  const files = new Map();
  loadState = {
    model: key,
    device: null,
    promise: new Promise((resolve, reject) => {
      const onMsg = (e) => {
        const m = e.data;
        if (m.type === 'progress') {
          if (m.total) files.set(m.file, { loaded: m.loaded || 0, total: m.total });
          if (m.status === 'done' && files.has(m.file)) files.get(m.file).loaded = files.get(m.file).total;
          let l = 0;
          let t = 0;
          for (const f of files.values()) {
            l += f.loaded;
            t += f.total;
          }
          onProgress?.(t ? l / t : 0, t ? `${(l / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB` : '');
        } else if (m.type === 'ready') {
          w.removeEventListener('message', onMsg);
          loadState.device = m.device;
          resolve(m);
        } else if (m.type === 'error' && m.id === undefined) {
          w.removeEventListener('message', onMsg);
          loadState = { model: null, promise: null, device: null };
          reject(new Error(m.message));
        }
      };
      w.addEventListener('message', onMsg);
      w.postMessage({ type: 'load', model, device });
    }),
  };
  return loadState.promise;
}

export function loadedDevice() {
  return loadState.device;
}

export function modelLoaded(model, device = 'auto') {
  return loadState.model === `${model}|${device}` && loadState.device !== null;
}

let reqId = 0;
export function transcribe(audio, language) {
  const w = worker();
  const id = ++reqId;
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      if (e.data.type === 'result') resolve(e.data);
      else reject(new Error(e.data.message));
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'transcribe', id, audio, language }, [audio.buffer]);
  });
}

export async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput');
  } catch {
    return [];
  }
}

/**
 * Event:
 *  - level  { rms, speaking }
 *  - heard  { text, ms, sentAt, latency }
 *  - error  { message }
 */
export class VoiceFollower extends EventTarget {
  constructor({ model, language = 'indonesian', deviceId = '' }) {
    super();
    this.model = model;
    this.language = language;
    this.deviceId = deviceId;
    this.running = false;
    this.buffer = new Float32Array(RATE * 30);
    this.written = 0; // total sampel yang pernah masuk
    this.lastSent = 0;
    this.noise = 0.004;
    this.lastVoiceAt = 0;
    this.speechStartSample = 0;
    this.silentSince = performance.now();
    this.busy = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async start() {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.ctx = new AudioContext({ sampleRate: RATE });
    await this.ctx.audioWorklet.addModule(new URL('mic-worklet.js', document.baseURI).href);
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'mic-capture');
    this.node.port.onmessage = (e) => this.onChunk(e.data);
    this.source.connect(this.node);
    this.running = true;
    this.loop();
  }

  async stop() {
    this.running = false;
    try {
      this.source?.disconnect();
      this.node?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } catch {
      /* sudah tertutup */
    }
  }

  onChunk(chunk) {
    const cap = this.buffer.length;
    const start = this.written % cap;
    const first = Math.min(chunk.length, cap - start);
    this.buffer.set(chunk.subarray(0, first), start);
    if (first < chunk.length) this.buffer.set(chunk.subarray(first), 0);
    this.written += chunk.length;

    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / chunk.length);
    const now = performance.now();
    const threshold = Math.max(0.012, this.noise * 3.2);
    const speaking = rms > threshold;
    if (speaking) {
      if (now - this.lastVoiceAt > 1400) this.speechStartSample = Math.max(0, this.written - chunk.length - RATE * 0.3);
      this.lastVoiceAt = now;
    } else {
      // lantai derau naik pelan, turun cepat
      this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : this.noise * 0.995 + rms * 0.005;
    }
    this.emit('level', { rms, speaking: now - this.lastVoiceAt < HANGOVER_MS });
  }

  isSpeaking() {
    return performance.now() - this.lastVoiceAt < HANGOVER_MS;
  }

  snapshot() {
    const cap = this.buffer.length;
    const from = Math.max(this.written - RATE * WINDOW_S, this.speechStartSample, this.written - cap);
    const len = this.written - from;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = this.buffer[(from + i) % cap];
    return out;
  }

  async loop() {
    while (this.running) {
      const fresh = (this.written - this.lastSent) / RATE;
      const recentVoice = performance.now() - this.lastVoiceAt < HANGOVER_MS + 300;
      if (!this.busy && recentVoice && fresh >= MIN_NEW_S) {
        this.busy = true;
        this.lastSent = this.written;
        const sentAt = performance.now();
        try {
          const audio = this.snapshot();
          if (audio.length > RATE * 0.6) {
            const r = await transcribe(audio, this.language);
            if (this.running) this.emit('heard', { text: r.text, ms: r.ms, sentAt, latency: performance.now() - sentAt });
          }
        } catch (err) {
          this.emit('error', { message: String(err?.message || err) });
        } finally {
          this.busy = false;
        }
      } else {
        await new Promise((r) => setTimeout(r, 60));
      }
    }
  }
}
