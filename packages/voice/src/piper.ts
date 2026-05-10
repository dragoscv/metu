/**
 * Piper TTS — local neural TTS via Tauri sidecar.
 *
 * Companion-Agent slice 2: registers `piper-local` provider id with a
 * sidecar runner factory the companion sets at bootstrap. Piper voices are
 * `.onnx + .onnx.json` pairs (~30–60MB each) provisioned under
 * `apps/companion/src-tauri/binaries/piper-voices/<voiceId>/` and the
 * binary itself under `binaries/piper-<triple>`.
 *
 * In runtimes without a sidecar (web), `speak()` yields a single empty
 * chunk and ends; pair with `router.ts` so the chain falls through.
 */
import type { TTSProvider, TTSSpeakOpts } from './types';
import { registerVoiceProvider } from './registry';

type SpeakFactory = (text: string, opts: TTSSpeakOpts) => AsyncIterable<Uint8Array>;
let _speakFactory: SpeakFactory | null = null;

export function setPiperSpeakFactory(factory: SpeakFactory | null): void {
  _speakFactory = factory;
}

async function* emptyStream(): AsyncIterable<Uint8Array> {
  // No sidecar → no audio. Caller's chain should detect 0 bytes and skip.
  return;
}

export const PiperLocalProvider: TTSProvider = {
  kind: 'tts',
  id: 'piper-local',
  speak(text: string, opts: TTSSpeakOpts): AsyncIterable<Uint8Array> {
    if (!_speakFactory) return emptyStream();
    return _speakFactory(text, opts);
  },
};

if (typeof globalThis !== 'undefined') {
  registerVoiceProvider(PiperLocalProvider);
}
