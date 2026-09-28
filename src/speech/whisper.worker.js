import { pipeline, env } from '@huggingface/transformers';
// Berkas runtime ONNX dibundel bersama aplikasi agar tidak perlu CDN.
import ortMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';

env.allowLocalModels = false;
env.useBrowserCache = true;

let asr = null;
let loaded = { model: null, device: null };

env.backends.onnx.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
env.backends.onnx.wasm.numThreads = Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 4) - 1));

async function hasWebGPU() {
  try {
    if (!self.navigator.gpu) return false;
    const adapter = await self.navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

async function load(model, want) {
  if (asr && loaded.model === model && loaded.want === want) return loaded;
  if (asr) {
    await asr.dispose?.();
    asr = null;
  }
  const progress = (p) => {
    if (p.status === 'progress' || p.status === 'download' || p.status === 'done') {
      self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total, status: p.status });
    }
  };
  const tryDevice = async (device) => {
    const dtype = device === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : 'q8';
    return pipeline('automatic-speech-recognition', model, { device, dtype, progress_callback: progress });
  };
  let device = want !== 'wasm' && (await hasWebGPU()) ? 'webgpu' : 'wasm';
  try {
    asr = await tryDevice(device);
  } catch (err) {
    if (device !== 'webgpu') throw err;
    device = 'wasm';
    asr = await tryDevice(device);
  }
  // Pemanasan agar ucapan pertama tidak lambat.
  await asr(new Float32Array(16000), { language: 'indonesian', task: 'transcribe' });
  loaded = { model, device, want };
  return loaded;
}

const JUNK = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|♪/g;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      const info = await load(msg.model, msg.device || 'auto');
      self.postMessage({ type: 'ready', ...info });
    } else if (msg.type === 'transcribe') {
      if (!asr) throw new Error('Model belum dimuat');
      const t0 = performance.now();
      const out = await asr(msg.audio, {
        language: msg.language || 'indonesian',
        task: 'transcribe',
        return_timestamps: false,
        max_new_tokens: 64,
      });
      const text = String(out?.text || '').replace(JUNK, ' ').trim();
      self.postMessage({ type: 'result', id: msg.id, text, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err?.message || err) });
  }
};
