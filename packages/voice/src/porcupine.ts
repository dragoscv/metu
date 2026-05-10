/**
 * Porcupine wake-word adapter — Picovoice Porcupine v3 (web/native).
 *
 * Companion-Agent slice 4: dormant adapter, mirrors `local-whisper.ts` and
 * `piper.ts`. The provider id `'porcupine'` is registered at import time
 * so routing / persona schema can already reference it. Real inference
 * runs in the companion webview via `@picovoice/porcupine-web` once the
 * user installs the optional dep AND provides their access key:
 *
 *   1. `pnpm --filter @metu/companion add @picovoice/porcupine-web @picovoice/web-voice-processor`
 *   2. Set `VITE_PORCUPINE_ACCESS_KEY` in `.env.local` (free Picovoice tier).
 *   3. Optionally bundle a custom `*.ppn` keyword file under
 *      `apps/companion/public/wake/<persona-slug>.ppn` and reference it
 *      via the persona's `wakeWord` field — built-ins like `'jarvis'` or
 *      `'hey-google'` are recognised without a custom file.
 *
 * Without that, `start()` resolves immediately with a no-op handle and
 * logs a hint once. Routing then tries the `open-wake-word` fallback.
 *
 * Companion wires this via `useWakeWord(personaWord)` in
 * `apps/companion/src/state/useWakeWord.ts`.
 */
import type { Off, WakeWordProvider } from './types';
import { registerVoiceProvider } from './registry';

/**
 * Optional injection point so the companion can supply a host-specific
 * runner (e.g. Tauri sidecar or native plugin) without this package
 * importing browser-only modules at typecheck time.
 */
export type PorcupineRunner = (model: string, onWake: () => void) => Promise<Off>;

let runnerFactory: (() => PorcupineRunner) | null = null;
export function setPorcupineRunnerFactory(factory: (() => PorcupineRunner) | null): void {
  runnerFactory = factory;
}

let warned = false;

export const PorcupineProvider: WakeWordProvider = {
  kind: 'wake',
  id: 'porcupine',
  async start(model: string, onWake: () => void): Promise<Off> {
    if (!runnerFactory) {
      if (!warned) {
        warned = true;
        // eslint-disable-next-line no-console
        console.info(
          '[wake] porcupine runner not registered — install @picovoice/porcupine-web + set VITE_PORCUPINE_ACCESS_KEY, then call setPorcupineRunnerFactory().',
        );
      }
      return () => {};
    }
    const runner = runnerFactory();
    return runner(model, onWake);
  },
};

if (typeof globalThis !== 'undefined') {
  registerVoiceProvider(PorcupineProvider);
}
