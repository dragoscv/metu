/* eslint-disable no-undef */
// AudioWorklet runs in AudioWorkletGlobalScope which exposes
// `AudioWorkletProcessor`, `registerProcessor`, and `sampleRate` as
// globals not visible to the default ESLint browser env.
/**
 * AudioWorklet processor that downsamples mic audio to 16 kHz mono and
 * posts 1280-sample (80 ms) chunks to the main thread. The wake-word
 * inference loop reads those chunks into a 16 000-sample (1 s) sliding
 * buffer and runs ONNX inference against it.
 *
 * The downsampler is a naive averaging decimator. Good enough for
 * keyword spotting at the 16 kHz target; not suitable for speech
 * recognition without a low-pass filter.
 */
const TARGET_SR = 16000;
const HOP_SAMPLES = 1280; // 80 ms at 16 kHz

class WakeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_SR;
    this.acc = 0;
    this.chunk = new Float32Array(HOP_SAMPLES);
    this.chunkIdx = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        this.chunk[this.chunkIdx++] = ch[i];
        if (this.chunkIdx >= HOP_SAMPLES) {
          this.port.postMessage(this.chunk.slice(0));
          this.chunkIdx = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('wake-processor', WakeProcessor);
