const KEY = 'sorot.settings.v1';

export const DEFAULTS = {
  mode: 'voice', // voice | auto | manual
  layout: 'top', // top = naskah di atas (dekat kamera), slide di bawah; bottom = kebalikannya
  split: 0.56, // porsi tinggi untuk slide
  fontSize: 44,
  lineHeight: 1.45,
  textWidth: 78, // persen lebar area prompter
  readingLine: 0.32, // posisi garis baca dari atas area prompter
  mirror: false,
  wpm: 120,
  model: 'onnx-community/whisper-base',
  language: 'indonesian',
  device: 'auto', // auto | wasm | webgpu
  micId: '',
  autoSlide: true,
  showClock: true,
  targetMinutes: 0,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* penyimpanan penuh atau dinonaktifkan */
  }
}
