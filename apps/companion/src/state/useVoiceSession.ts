/**
 * Companion-side voice session controller — persona-aware dispatcher.
 *
 * Routes to the correct lane based on `persona.voiceProvider`:
 *   - `openai-realtime` → Realtime (lane 1, WebRTC, low-latency, native barge-in)
 *   - `cartesia-sonic-turbo` / `elevenlabs-flash` → Pipeline (lane 2,
 *      Deepgram STT → text LLM → server-proxied TTS)
 *   - `none` → text-only persona; nothing to mount.
 *
 * Both lanes expose the same `{state, start, stop, interrupt, setMicEnabled,
 * setAudioElement}` surface so the Panel UI doesn't care which one is running.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { OpenAiRealtimeProvider, registerOpenAiRealtime } from '@metu/voice/openai-realtime';
import { DeepgramNova3Provider, registerDeepgramNova3 } from '@metu/voice/deepgram';
import { MetuTtsProxyProvider, registerMetuTtsProxy } from '@metu/voice/tts-proxy';
import { createPipelineSession, type PipelineSessionHandle } from '@metu/voice/pipeline';
import type { RealtimeSession, VoiceSessionEvent } from '@metu/voice';
import type { AuthState } from './auth';
import { fetchScreenContext } from '../assistant/activityModel';

registerOpenAiRealtime();
registerDeepgramNova3();
registerMetuTtsProxy();

export type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'listening' | 'speaking' | 'error';

export interface VoiceState {
  status: VoiceStatus;
  partial: string;
  finalText: string | null;
  errorMessage: string | null;
  lastToolCall: { tool: string; args: Record<string, unknown> } | null;
  lane: 'realtime' | 'pipeline' | null;
}

const DEFAULT_PERSONA = 'atlas';

interface RealtimeBrokerOk {
  ok: true;
  sessionToken: string;
  sessionId: string;
  model: string;
  voice: string;
  expiresInSec: number;
  persona: { slug: string; name: string; systemPrompt: string };
}
interface PipelineBrokerOk {
  ok: true;
  lane: 'pipeline';
  persona: {
    slug: string;
    name: string;
    systemPrompt: string;
    ttsProvider: string;
    ttsVoiceId: string;
    ttsTuning?: Record<string, number | undefined>;
  };
  stt: {
    provider: string;
    sessionToken: string;
    expiresInSec: number;
    params?: Record<string, string>;
  };
}
interface BrokerErr {
  ok: false;
  error: string;
  hint?: string;
}

async function postBroker<T extends { ok: true }>(
  auth: AuthState,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${auth.apiBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T | BrokerErr;
  if (!res.ok || !json.ok) {
    const err = (json as BrokerErr).error ?? `http_${res.status}`;
    const hint = (json as BrokerErr).hint ? ` (${(json as BrokerErr).hint})` : '';
    throw new Error(`broker_${err}${hint}`);
  }
  return json;
}

type ActiveLane =
  | { kind: 'realtime'; session: RealtimeSession }
  | { kind: 'pipeline'; session: PipelineSessionHandle; mic: MediaStream };

export function useVoiceSession(auth: AuthState | null) {
  const [state, setState] = useState<VoiceState>({
    status: 'idle',
    partial: '',
    finalText: null,
    errorMessage: null,
    lastToolCall: null,
    lane: null,
  });
  const activeRef = useRef<ActiveLane | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Rolling transcript history fed into shadow-triage so the classifier
  // sees recent context, not just the latest utterance in isolation.
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  // Persona slug of the live realtime session — needed when we POST to
  // /companion/triage from the 'final' event handler.
  const realtimePersonaRef = useRef<string | null>(null);

  const setAudioElement = useCallback((el: HTMLAudioElement | null) => {
    audioRef.current = el;
  }, []);

  const fireShadowTriage = useCallback(
    async (utterance: string) => {
      if (!auth) return;
      const personaSlug = realtimePersonaRef.current;
      if (!personaSlug) return;
      const history = historyRef.current.slice(-12);
      // Append the utterance after slicing so it's the next turn's context.
      historyRef.current = [...historyRef.current.slice(-19), { role: 'user', content: utterance }];
      try {
        const res = await fetch(`${auth.apiBase.replace(/\/$/, '')}/api/sdk/v1/companion/triage`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${auth.accessToken}`,
          },
          body: JSON.stringify({
            personaSlug,
            utterance,
            history,
            surface: 'companion',
          }),
        });
        if (!res.ok) return;
        const json = (await res.json().catch(() => null)) as {
          ok: true;
          escalated: boolean;
          triage: { reason: string };
        } | null;
        if (json?.ok && json.escalated) {
          // Hard interrupt the realtime audio so the persona stops talking
          // mid-thought — the Conductor is now driving and a notification
          // is on its way. Without this, the realtime persona keeps
          // narrating in parallel with the escalation, which is jarring.
          activeRef.current?.session.interrupt();
          setState((p) => ({
            ...p,
            status: 'ready',
            partial: '',
            lastToolCall: {
              tool: 'conductor.escalate',
              args: { reason: json.triage.reason },
            },
          }));
        }
      } catch {
        // Shadow triage must never break the live conversation.
      }
    },
    [auth],
  );

  const handleEvent = useCallback(
    (ev: VoiceSessionEvent) => {
      setState((prev) => {
        switch (ev.type) {
          case 'partial':
            return { ...prev, partial: ev.text, status: 'speaking' };
          case 'final':
            return { ...prev, finalText: ev.text, partial: '', status: 'ready' };
          case 'speaking':
            return { ...prev, status: ev.value ? 'listening' : 'ready' };
          case 'tool_call':
            return { ...prev, lastToolCall: { tool: ev.tool, args: ev.args } };
          case 'error':
            return { ...prev, status: 'error', errorMessage: ev.message };
          case 'closed':
            return { ...prev, status: 'idle' };
        }
      });
      // Realtime providers handle the spoken reply themselves; we run
      // triage in parallel on the user's final transcript so escalation
      // (heavy Conductor work) still happens without blocking audio.
      if (ev.type === 'final' && activeRef.current?.kind === 'realtime' && ev.text.trim()) {
        void fireShadowTriage(ev.text.trim());
      }
    },
    [fireShadowTriage],
  );

  const startRealtime = useCallback(
    async (personaSlug: string): Promise<void> => {
      if (!auth) return;
      const minted = await postBroker<RealtimeBrokerOk>(auth, '/api/voice/realtime/session', {
        personaSlug,
      });
      // Jarvis Slice F — seed the realtime session with the current screen
      // context. (Realtime sessions can't refresh per-turn without a
      // session.update round-trip; the start snapshot covers the common
      // "what am I looking at?" case and the pipeline lane gets per-turn.)
      const screen = await fetchScreenContext().catch(() => '');
      const systemPrompt = screen
        ? `${minted.persona.systemPrompt}\n\n[Live screen context at session start]\n${screen}`
        : minted.persona.systemPrompt;
      const session = await OpenAiRealtimeProvider.open({
        sessionToken: minted.sessionToken,
        systemPrompt,
        voiceId: minted.voice,
        audioEl: audioRef.current,
      });
      const off = session.on(handleEvent);
      const origStop = session.stop.bind(session);
      session.stop = async () => {
        off();
        await origStop();
      };
      activeRef.current = { kind: 'realtime', session };
      realtimePersonaRef.current = personaSlug;
      historyRef.current = [];
      setState((p) => ({ ...p, lane: 'realtime' }));
      await session.start();
      setState((p) => ({ ...p, status: 'ready' }));
    },
    [auth, handleEvent],
  );

  const startPipeline = useCallback(
    async (personaSlug: string): Promise<void> => {
      if (!auth || !audioRef.current) {
        throw new Error('audio_element_not_ready');
      }
      const minted = await postBroker<PipelineBrokerOk>(auth, '/api/voice/pipeline/session', {
        personaSlug,
      });
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      // Start muted — user holds the hotkey to talk.
      for (const t of mic.getAudioTracks()) t.enabled = false;
      const session = createPipelineSession({
        apiBase: auth.apiBase,
        accessToken: auth.accessToken,
        personaSlug,
        stt: DeepgramNova3Provider,
        sttOpenOpts: {
          sessionToken: minted.stt.sessionToken,
          inputMime: 'audio/webm',
          // Re-using the hook-owned mic stream avoids a second permission prompt
          // and lets us mute via track.enabled without tearing the WS down.
          micStream: mic,
          params: minted.stt.params,
        } as Parameters<typeof DeepgramNova3Provider.open>[0],
        tts: MetuTtsProxyProvider,
        audioEl: audioRef.current,
        // Jarvis Slice F — every voice turn carries live screen context
        // (focused app + recent OCR text, privacy-gated natively) so
        // "what am I looking at?" works hands-free too.
        getScreenContext: fetchScreenContext,
      });
      const off = session.on(handleEvent);
      const origStop = session.stop.bind(session);
      session.stop = async () => {
        off();
        for (const t of mic.getAudioTracks()) t.stop();
        await origStop();
      };
      activeRef.current = { kind: 'pipeline', session, mic };
      setState((p) => ({ ...p, lane: 'pipeline' }));
      await session.start();
      setState((p) => ({ ...p, status: 'ready' }));
    },
    [auth, handleEvent],
  );

  const start = useCallback(
    async (personaSlug = DEFAULT_PERSONA, voiceProvider: string = 'openai-realtime') => {
      if (!auth) return;
      if (activeRef.current) return;
      setState((p) => ({ ...p, status: 'connecting', errorMessage: null }));
      try {
        if (voiceProvider === 'openai-realtime') {
          await startRealtime(personaSlug);
        } else if (voiceProvider === 'none') {
          setState((p) => ({ ...p, status: 'idle', lane: null }));
        } else {
          await startPipeline(personaSlug);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setState((p) => ({ ...p, status: 'error', errorMessage: msg }));
      }
    },
    [auth, startRealtime, startPipeline],
  );

  const stop = useCallback(async () => {
    const a = activeRef.current;
    activeRef.current = null;
    realtimePersonaRef.current = null;
    historyRef.current = [];
    setState((p) => ({ ...p, status: 'idle', partial: '', lane: null }));
    if (!a) return;
    await a.session.stop();
  }, []);

  const interrupt = useCallback(() => {
    activeRef.current?.session.interrupt();
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    const a = activeRef.current;
    if (!a) return;
    if (a.kind === 'realtime') {
      if (enabled) a.session.resume();
      else a.session.pause();
    } else {
      for (const t of a.mic.getAudioTracks()) t.enabled = enabled;
      if (!enabled) a.session.interrupt();
    }
  }, []);

  // Tear down on unmount or auth change.
  useEffect(() => {
    return () => {
      const a = activeRef.current;
      activeRef.current = null;
      if (a) void a.session.stop();
    };
  }, [auth?.accessToken]);

  return { state, start, stop, interrupt, setMicEnabled, setAudioElement };
}
