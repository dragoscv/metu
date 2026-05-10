/**
 * OpenAI Realtime — WebRTC transport adapter.
 *
 * Lives in `@metu/voice` so it can be reused by any webview-class runtime
 * (companion, web, browser-ext). Mobile uses the same provider id but a
 * different transport (WebSocket via expo's RN WebRTC).
 *
 * Lifecycle:
 *   1. Caller fetches an ephemeral session token from the web broker
 *      `/api/voice/realtime/session`. The token has a ~60s TTL.
 *   2. `open()` creates an RTCPeerConnection, attaches the user's mic, opens
 *      a data channel for events (`oai-events`), and POSTs the local SDP to
 *      `https://api.openai.com/v1/realtime?model=…` using the ephemeral key.
 *      OpenAI replies with the answer SDP.
 *   3. The remote audio track plays back via an `<audio autoplay>` element
 *      injected by `attachAudioElement(el)`.
 *   4. Events on the data channel are mapped to `VoiceSessionEvent`s.
 *
 * Barge-in is handled by sending `response.cancel` over the data channel
 * via `interrupt()`. Server-side VAD is configured in the broker.
 */
import { registerVoiceProvider } from './registry';
import type {
  Off,
  RealtimeOpenOpts,
  RealtimeProvider,
  RealtimeSession,
  VoiceSessionEvent,
} from './types';

const REALTIME_BASE = 'https://api.openai.com/v1/realtime';

export interface OpenAiRealtimeBrowserOpts extends RealtimeOpenOpts {
  /** Model id passed as `?model=`. Defaults to the broker's default. */
  model?: string;
  /** Audio element the remote track is bound to. Optional — caller can attach later. */
  audioEl?: HTMLAudioElement | null;
  /** Existing media stream (skips getUserMedia). Used by tests. */
  micStream?: MediaStream | null;
}

const DEFAULT_MODEL = 'gpt-4o-realtime-preview-2024-12-17';

class OpenAiRealtimeWebRTCSession implements RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private listeners = new Set<(ev: VoiceSessionEvent) => void>();
  private partial = '';

  constructor(private opts: OpenAiRealtimeBrowserOpts) {
    this.audioEl = opts.audioEl ?? null;
  }

  on(cb: (ev: VoiceSessionEvent) => void): Off {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: VoiceSessionEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  attachAudioElement(el: HTMLAudioElement): void {
    this.audioEl = el;
    const remote = this.pc
      ?.getReceivers()
      .map((r) => r.track)
      .find((t) => t?.kind === 'audio');
    if (remote && el) {
      const stream = new MediaStream([remote]);
      el.srcObject = stream;
      void el.play().catch(() => {});
    }
  }

  async start(): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: this.opts.iceServers as RTCIceServer[] | undefined,
    });
    this.pc = pc;

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      if (this.audioEl && stream) {
        this.audioEl.srcObject = stream;
        void this.audioEl.play().catch(() => {});
      }
    };

    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onopen = () => {
      // Send a session.update so tools are wired even if the broker missed them.
      if (this.opts.tools && this.opts.tools.length > 0) {
        dc.send(
          JSON.stringify({
            type: 'session.update',
            session: {
              tools: this.opts.tools.map((t) => ({
                type: 'function',
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
              tool_choice: 'auto',
            },
          }),
        );
      }
    };
    dc.onmessage = (msg) => this.handleEvent(msg.data);
    dc.onclose = () => this.emit({ type: 'closed' });

    const mic =
      this.opts.micStream ??
      (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
    this.mic = mic;
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    const model = this.opts.model ?? DEFAULT_MODEL;
    const res = await fetch(`${REALTIME_BASE}?model=${encodeURIComponent(model)}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opts.sessionToken}`,
        'content-type': 'application/sdp',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: offer.sdp ?? '',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`realtime_sdp_exchange_failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const answer: RTCSessionDescriptionInit = { type: 'answer', sdp: await res.text() };
    await pc.setRemoteDescription(answer);
  }

  pushAudio(_chunk: ArrayBuffer): void {
    // WebRTC carries the mic track natively; this is a no-op in this transport.
    // Pipeline mode (lane 2) is the one that consumes pushAudio.
  }

  pause(): void {
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = false;
  }
  resume(): void {
    for (const t of this.mic?.getAudioTracks() ?? []) t.enabled = true;
  }

  interrupt(): void {
    this.dc?.readyState === 'open' && this.dc.send(JSON.stringify({ type: 'response.cancel' }));
  }

  async stop(): Promise<void> {
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    for (const t of this.mic?.getAudioTracks() ?? []) t.stop();
    this.mic = null;
    this.dc = null;
    this.pc = null;
    this.emit({ type: 'closed' });
  }

  // ─── Event mapping ─────────────────────────────────────────────────────
  private handleEvent(raw: string): void {
    let ev: { type?: string; [k: string]: unknown };
    try {
      ev = JSON.parse(raw) as { type?: string };
    } catch {
      return;
    }
    switch (ev.type) {
      case 'response.audio_transcript.delta': {
        const delta = (ev as { delta?: string }).delta ?? '';
        this.partial += delta;
        this.emit({ type: 'partial', text: this.partial });
        return;
      }
      case 'response.audio_transcript.done': {
        const text = (ev as { transcript?: string }).transcript ?? this.partial;
        this.partial = '';
        this.emit({ type: 'final', text });
        return;
      }
      case 'input_audio_buffer.speech_started':
        this.emit({ type: 'speaking', value: true });
        return;
      case 'input_audio_buffer.speech_stopped':
        this.emit({ type: 'speaking', value: false });
        return;
      case 'response.function_call_arguments.done': {
        const e = ev as { call_id?: string; name?: string; arguments?: string };
        let args: Record<string, unknown> = {};
        try {
          args = e.arguments ? (JSON.parse(e.arguments) as Record<string, unknown>) : {};
        } catch {
          /* keep empty */
        }
        if (e.call_id && e.name) {
          this.emit({ type: 'tool_call', id: e.call_id, tool: e.name, args });
        }
        return;
      }
      case 'error': {
        const e = ev as { error?: { message?: string } };
        this.emit({ type: 'error', message: e.error?.message ?? 'realtime error' });
        return;
      }
    }
  }
}

export const OpenAiRealtimeProvider: RealtimeProvider = {
  kind: 'realtime',
  id: 'openai-realtime',
  async open(opts) {
    return new OpenAiRealtimeWebRTCSession(opts as OpenAiRealtimeBrowserOpts);
  },
};

/**
 * Idempotent registration. Adapter modules call this at import time on the
 * runtime that should host the provider (webview side, never server).
 */
export function registerOpenAiRealtime(): void {
  registerVoiceProvider(OpenAiRealtimeProvider);
}
