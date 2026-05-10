/**
 * Anthropic Realtime adapter — stub for the not-yet-stable public API.
 *
 * Companion-Agent slice 2: we expose the provider id and a clean failure
 * shape so the persona schema, registry, and routing helpers can already
 * reference `'anthropic-realtime'`. The real WebRTC/WS handshake lands
 * when Anthropic ships a public spec; until then the broker route in
 * `apps/web/src/app/api/voice/realtime/session/route.ts` should reject
 * with the same `anthropic_realtime_unavailable` error so callers fall
 * back to the next provider in the routing chain (router.ts).
 *
 * Imported for side-effect: `import '@metu/voice/anthropic-realtime'`
 * registers it. Web/companion side-effect imports decide whether to
 * surface it (gated by env flag `METU_VOICE_ANTHROPIC=1`).
 */
import type {
  RealtimeOpenOpts,
  RealtimeProvider,
  RealtimeSession,
  VoiceSessionEvent,
  Off,
} from './types';
import { registerVoiceProvider } from './registry';

class AnthropicRealtimeUnavailableSession implements RealtimeSession {
  private listeners = new Set<(ev: VoiceSessionEvent) => void>();
  async start(): Promise<void> {
    queueMicrotask(() => {
      for (const cb of this.listeners) {
        cb({ type: 'error', message: 'anthropic_realtime_unavailable' });
        cb({ type: 'closed' });
      }
    });
  }
  pause(): void {}
  resume(): void {}
  interrupt(): void {}
  async stop(): Promise<void> {}
  pushAudio(_chunk: ArrayBuffer): void {}
  on(cb: (ev: VoiceSessionEvent) => void): Off {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

export const AnthropicRealtimeProvider: RealtimeProvider = {
  kind: 'realtime',
  id: 'anthropic-realtime',
  async open(_opts: RealtimeOpenOpts): Promise<RealtimeSession> {
    return new AnthropicRealtimeUnavailableSession();
  },
};

if (typeof globalThis !== 'undefined') {
  registerVoiceProvider(AnthropicRealtimeProvider);
}
