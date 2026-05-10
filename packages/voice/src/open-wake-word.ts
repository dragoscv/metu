/**
 * openWakeWord adapter — MIT-licensed on-device wake detector.
 *
 * Companion-Agent slice 4: dormant adapter, mirrors `porcupine.ts`. The
 * provider id `'open-wake-word'` self-registers at import time. Real
 * inference runs against an ONNX model loaded with `onnxruntime-web` in
 * the companion webview, or `onnxruntime-react-native` on mobile.
 *
 * Activation:
 *   1. `pnpm --filter @metu/companion add onnxruntime-web` (or
 *      `onnxruntime-react-native` on mobile).
 *   2. Drop the `.onnx` model under `apps/companion/public/wake/<word>.onnx`
 *      (download from https://github.com/dscripka/openWakeWord — or train
 *      a custom one with the colab in that repo).
 *   3. Set `VITE_OPENWAKEWORD_MODEL_URL` to the asset URL OR rely on the
 *      persona's `wakeWord` field naming the file.
 *   4. Call `setOpenWakeWordRunnerFactory(...)` from the companion entry.
 *
 * Without all of that, `start()` resolves with a no-op handle (logs once)
 * so `pickWakeRoute()` can fall through cleanly.
 *
 * Why two providers? Porcupine has the lowest latency and best accuracy
 * but ties you to a Picovoice account; openWakeWord is fully free /
 * offline / unlimited. Persona-level choice + costTier drive routing.
 */
import type { Off, WakeWordProvider } from './types';
import { registerVoiceProvider } from './registry';

export type OpenWakeWordRunner = (model: string, onWake: () => void) => Promise<Off>;

let runnerFactory: (() => OpenWakeWordRunner) | null = null;
export function setOpenWakeWordRunnerFactory(factory: (() => OpenWakeWordRunner) | null): void {
  runnerFactory = factory;
}

let warned = false;

export const OpenWakeWordProvider: WakeWordProvider = {
  kind: 'wake',
  id: 'open-wake-word',
  async start(model: string, onWake: () => void): Promise<Off> {
    if (!runnerFactory) {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.info(
          '[wake] openWakeWord runner not registered — install onnxruntime-web + drop a .onnx model, then call setOpenWakeWordRunnerFactory().',
        );
      }
      return () => {};
    }
    const runner = runnerFactory();
    return runner(model, onWake);
  },
};

if (typeof globalThis !== 'undefined') {
  registerVoiceProvider(OpenWakeWordProvider);
}
