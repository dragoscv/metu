/**
 * Local Whisper STT — Tauri sidecar adapter (companion only).
 *
 * Companion-Agent slice 2: registers the `local-whisper-cpp` provider id
 * and exposes a thin streaming surface that calls into a Rust sidecar
 * binary. The actual `whisper.cpp` binary is provisioned per-platform
 * under `apps/companion/src-tauri/binaries/whisper-server-<triple>` and
 * spoken to via Tauri's plugin-shell sidecar protocol; provisioning is a
 * separate slice (the sidecar drop is heavy, ~40MB per platform).
 *
 * If no sidecar is present (web or non-companion runtimes), `open()` emits
 * a single `error` event with `local_whisper_sidecar_missing` and closes —
 * the routing helper falls back to the next STT provider.
 *
 * Privacy contract: this is the lane the Conductor uses when the user has
 * `localFirst=true` or no internet. Audio NEVER leaves the device.
 */
import type { Off, STTOpenOpts, STTProvider, STTStream, VoiceSessionEvent } from './types';
import { registerVoiceProvider } from './registry';

type SidecarRunner = {
  /** Push a PCM/Opus chunk to the running sidecar. */
  push(chunk: ArrayBuffer): void;
  /** Close stdin and await the final transcript. */
  end(): Promise<void>;
  /** Subscribe to partial/final transcripts emitted from the sidecar. */
  on(cb: (ev: VoiceSessionEvent) => void): Off;
};

/**
 * Pluggable runner factory — set by the companion's bootstrap code with the
 * Tauri-flavored implementation. Web runtimes leave this null and the
 * provider degrades gracefully.
 */
type RunnerFactory = (opts: STTOpenOpts) => Promise<SidecarRunner>;
let _runnerFactory: RunnerFactory | null = null;

export function setLocalWhisperRunnerFactory(factory: RunnerFactory | null): void {
  _runnerFactory = factory;
}

class MissingSidecarStream implements STTStream {
  private listeners = new Set<(ev: VoiceSessionEvent) => void>();
  push(_chunk: ArrayBuffer): void {}
  async end(): Promise<void> {
    for (const cb of this.listeners) {
      cb({ type: 'error', message: 'local_whisper_sidecar_missing' });
      cb({ type: 'closed' });
    }
  }
  on(cb: (ev: VoiceSessionEvent) => void): Off {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const LocalWhisperProvider: STTProvider = {
  kind: 'stt',
  id: 'local-whisper-cpp',
  async open(opts: STTOpenOpts): Promise<STTStream> {
    if (!_runnerFactory) return new MissingSidecarStream();
    const runner = await _runnerFactory(opts);
    return {
      push: (c) => runner.push(c),
      end: () => runner.end(),
      on: (cb) => runner.on(cb),
    };
  },
};

if (typeof globalThis !== 'undefined') {
  registerVoiceProvider(LocalWhisperProvider);
}
