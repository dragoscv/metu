/**
 * Server-proxied TTS adapter — speaks via `POST {apiBase}/api/voice/tts/speak`.
 *
 * The proxy on the web side picks the actual provider (Cartesia or
 * ElevenLabs) from the persona and never returns the raw API key. Adapter
 * just streams the audio chunks back from `Response.body`.
 *
 * Why one client adapter for two providers: keeping both providers
 * server-side means the client doesn't need their SDKs and the BYOK rule
 * stays intact. The persona slug carries the routing.
 */
import { registerVoiceProvider } from './registry';
import type { Off, TTSProvider, TTSSpeakOpts } from './types';

export interface MetuTtsProxyOpts extends TTSSpeakOpts {
  /** Web app base, e.g. `https://app.metu.local`. */
  apiBase: string;
  /** OAuth bearer of the paired user (the proxy enforces auth). */
  accessToken: string;
  /** Persona slug — the proxy looks up the actual provider. */
  personaSlug: string;
  /** Spoken-language hint forwarded to the TTS provider (e.g. 'ro'). */
  language?: string;
}

export interface ProxiedTtsProvider extends TTSProvider {
  /** Convenience to wire a sink while still streaming chunks downstream. */
  speakToAudioElement(text: string, opts: MetuTtsProxyOpts, audio: HTMLAudioElement): Promise<Off>;
}

export const MetuTtsProxyProvider: ProxiedTtsProvider = {
  kind: 'tts',
  id: 'metu-tts-proxy',

  async *speak(text: string, opts) {
    const o = opts as MetuTtsProxyOpts;
    const reader = await openTtsReader(text, o);
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
  },

  async speakToAudioElement(text, opts, audio) {
    // For a v1 implementation we play the COMPLETE audio (one HTTP response
    // per utterance). Streaming MP3 frame-by-frame to <audio> via MediaSource
    // is finicky across browsers; we'll add it in slice 5b if the lag is
    // user-perceptible. Cartesia + ElevenLabs flash both deliver in <300ms
    // for short responses.
    const reader = await openTtsReader(text, opts);
    try {
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      audio.src = url;
      await audio.play().catch(() => {});
      const off: Off = () => {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        URL.revokeObjectURL(url);
      };
      return off;
    } finally {
      reader.releaseLock();
    }
  },
};

async function openTtsReader(
  text: string,
  opts: MetuTtsProxyOpts,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const res = await fetch(`${opts.apiBase.replace(/\/$/, '')}/api/voice/tts/speak`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.accessToken}`,
    },
    body: JSON.stringify({
      personaSlug: opts.personaSlug,
      text,
      ...(opts.language ? { language: opts.language } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tts_proxy_failed_${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.body.getReader();
}

export function registerMetuTtsProxy(): void {
  registerVoiceProvider(MetuTtsProxyProvider);
}
