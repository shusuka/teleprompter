// Mengumpulkan sampel mikrofon lalu mengirimnya per ±100 ms ke utas utama.
class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 10);
    this.buf = new Float32Array(this.size);
    this.pos = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const n = Math.min(ch.length - i, this.size - this.pos);
        this.buf.set(ch.subarray(i, i + n), this.pos);
        this.pos += n;
        i += n;
        if (this.pos === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
