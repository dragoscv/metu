/**
 * Pipeline composer — wires STT → LLM → TTS for non-realtime personas.
 *
 * Lifecycle per "turn":
 *  1. STT emits `final` → call /api/sdk/v1/companion/turn/stream with the
 *     transcript + persona slug. The orchestrator triages first; if it
 *     escalates we play the localized ack and the heavy Conductor picks
 *     it up via Inngest. Otherwise it streams NDJSON deltas.
 *  2. We accumulate text and, every time we cross a sentence boundary,
 *     flush that sentence to TTS so the user hears the answer mid-stream.
 *  3. On `final`, flush any tail and emit `final` to listeners.
 *
 * Barge-in: when STT detects new speech (`speaking: true`), we cancel the
 * current TTS playback and abort the in-flight LLM request.
 */
import type { Off, STTProvider, TTSProvider, VoiceSessionEvent } from './types';
import type { MetuTtsProxyOpts } from './tts-proxy';

/** Strip the Jarvis v3 `CHIPS: [...]` trailer — UI affordance, never spoken. */
function stripChips(text: string): string {
  return text.replace(/\n?CHIPS:\s*\[[\s\S]*?\]\s*$/, '').trimEnd();
}

export interface PipelineSessionOpts {
  apiBase: string;
  accessToken: string;
  personaSlug: string;
  /** Response + spoken language (e.g. 'ro'); rides to turn + TTS calls. */
  language?: string;
  /** STT provider, e.g. Deepgram. */
  stt: STTProvider;
  sttOpenOpts: Parameters<STTProvider['open']>[0];
  /** TTS provider — usually `MetuTtsProxyProvider`. */
  tts: TTSProvider;
  /** Audio sink for spoken output. */
  audioEl: HTMLAudioElement;
  /**
   * Optional ambient screen context supplier (Jarvis Slice F). Called at
   * the start of every turn; the resolved text (focused app + recent
   * on-screen text, already privacy-gated by the caller) rides along to
   * the turn endpoint so "what am I looking at?" works by voice too.
   * Failures/timeouts must be handled by the supplier — return ''.
   */
  getScreenContext?: () => Promise<string>;
}

export interface PipelineSessionHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Cancel in-progress speech without tearing the session down (barge-in). */
  interrupt(): void;
  on(cb: (ev: VoiceSessionEvent) => void): Off;
}

export function createPipelineSession(opts: PipelineSessionOpts): PipelineSessionHandle {
  const listeners = new Set<(ev: VoiceSessionEvent) => void>();
  const emit = (ev: VoiceSessionEvent) => {
    for (const l of listeners) {
      try {
        l(ev);
      } catch {
        /* ignore */
      }
    }
  };

  let sttStream: Awaited<ReturnType<STTProvider['open']>> | null = null;
  let respondAbort: AbortController | null = null;
  let currentAudioStop: Off | null = null;
  // History across turns inside a single session — bounded.
  const history: { role: 'user' | 'assistant'; content: string }[] = [];

  function stopCurrentAudio() {
    try {
      currentAudioStop?.();
    } catch {
      /* ignore */
    }
    currentAudioStop = null;
  }

  async function speak(text: string) {
    if (!text.trim()) return;
    if (typeof (opts.tts as { speakToAudioElement?: unknown }).speakToAudioElement === 'function') {
      const proxy = opts.tts as unknown as {
        speakToAudioElement: (t: string, o: MetuTtsProxyOpts, el: HTMLAudioElement) => Promise<Off>;
      };
      try {
        currentAudioStop = await proxy.speakToAudioElement(
          text,
          {
            apiBase: opts.apiBase,
            accessToken: opts.accessToken,
            personaSlug: opts.personaSlug,
            voiceId: '',
            language: opts.language,
          },
          opts.audioEl,
        );
      } catch (err) {
        emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  async function runTurn(transcript: string) {
    respondAbort?.abort();
    stopCurrentAudio();

    const ac = new AbortController();
    respondAbort = ac;

    let accumulated = '';
    let pendingForTts = '';

    try {
      const screenContext = (await opts.getScreenContext?.().catch(() => '')) || undefined;
      if (ac.signal.aborted) return; // barge-in while fetching context
      const res = await fetch(
        `${opts.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/turn/stream`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.accessToken}`,
          },
          body: JSON.stringify({
            personaSlug: opts.personaSlug,
            utterance: transcript,
            history: history.slice(-12),
            surface: 'companion',
            screenContext,
            ...(opts.language ? { language: opts.language } : {}),
          }),
          signal: ac.signal,
        },
      );
      if (!res.ok || !res.body) {
        emit({ type: 'error', message: `respond_${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: {
            type?: string;
            text?: string;
            message?: string;
            triage?: { lane: string; reason: string; source: string };
            eventId?: string;
            toolCallNames?: string[];
          };
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.type === 'triage') {
            // Audit-only — no UI surface yet. Pipeline doesn't change
            // behaviour based on triage outcome since the stream itself
            // tells us (delta…final vs ack…escalated).
            continue;
          }
          if (parsed.type === 'ack' && parsed.text) {
            // Escalate path: speak the ack immediately, surface as partial
            // so the UI shows it, and treat it as the final assistant turn.
            accumulated = parsed.text;
            emit({ type: 'partial', text: accumulated });
            void speak(parsed.text);
          } else if (parsed.type === 'escalated') {
            history.push({ role: 'user', content: transcript });
            history.push({ role: 'assistant', content: accumulated });
            while (history.length > 24) history.shift();
            emit({ type: 'final', text: accumulated });
          } else if (parsed.type === 'delta' && parsed.text) {
            accumulated += parsed.text;
            pendingForTts += parsed.text;
            emit({ type: 'partial', text: stripChips(accumulated) });
            const flush = takeSentenceBoundary(pendingForTts);
            if (flush.flushed) {
              pendingForTts = flush.tail;
              void speak(stripChips(flush.flushed));
            }
          } else if (parsed.type === 'final') {
            const tail = stripChips((parsed.text ?? '').slice(accumulated.length) + pendingForTts);
            if (tail.trim()) void speak(tail);
            pendingForTts = '';
            const finalText = stripChips(parsed.text ?? accumulated);
            history.push({ role: 'user', content: transcript });
            history.push({ role: 'assistant', content: finalText });
            while (history.length > 24) history.shift();
            emit({ type: 'final', text: finalText });
          } else if (parsed.type === 'error') {
            emit({ type: 'error', message: parsed.message ?? 'respond_error' });
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return; // barge-in
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (respondAbort === ac) respondAbort = null;
    }
  }

  return {
    async start() {
      sttStream = await opts.stt.open(opts.sttOpenOpts);
      sttStream.on((ev) => {
        if (ev.type === 'speaking' && ev.value) {
          // User started talking again — cancel current response + audio.
          respondAbort?.abort();
          stopCurrentAudio();
          emit(ev);
        } else if (ev.type === 'final') {
          emit({ type: 'final', text: `🎙️ ${ev.text}` });
          void runTurn(ev.text);
        } else {
          emit(ev);
        }
      });
    },
    async stop() {
      respondAbort?.abort();
      stopCurrentAudio();
      await sttStream?.end();
      sttStream = null;
      emit({ type: 'closed' });
    },
    interrupt() {
      respondAbort?.abort();
      stopCurrentAudio();
    },
    on(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Pull the longest prefix of `text` that ends on a sentence boundary. */
function takeSentenceBoundary(text: string): { flushed: string; tail: string } {
  // Look for the last terminal punctuation followed by whitespace (or EOS).
  const re = /[.!?…]["')\]]?\s/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) lastIdx = m.index + m[0].length;
  if (lastIdx <= 0) return { flushed: '', tail: text };
  return { flushed: text.slice(0, lastIdx).trim(), tail: text.slice(lastIdx) };
}
