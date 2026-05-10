/**
 * Deepgram Nova-3 — browser STT adapter (WebSocket).
 *
 * Lives in a separate subpath (`@metu/voice/deepgram`) so DOM types stay
 * out of server-only consumers. Open the WS with the broker-issued token,
 * push `audio/webm`-class chunks via MediaRecorder, parse Deepgram's JSON
 * messages into `VoiceSessionEvent`s.
 */
import { registerVoiceProvider } from './registry';
import type { Off, STTOpenOpts, STTProvider, STTStream, VoiceSessionEvent } from './types';

const DEEPGRAM_BASE = 'wss://api.deepgram.com/v1/listen';

interface DeepgramOpenOpts extends STTOpenOpts {
  /** Extra query params beyond the broker defaults. */
  params?: Record<string, string>;
  /** Mic stream the caller already has (skips getUserMedia). */
  micStream?: MediaStream | null;
}

class DeepgramSttStream implements STTStream {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private mic: MediaStream | null = null;
  private listeners = new Set<(ev: VoiceSessionEvent) => void>();
  private closed = false;

  constructor(private opts: DeepgramOpenOpts) {}

  async open(): Promise<void> {
    if (!this.opts.sessionToken) throw new Error('deepgram_missing_token');

    const params: Record<string, string> = {
      model: 'nova-3',
      smart_format: 'true',
      interim_results: 'true',
      endpointing: '300',
      ...(this.opts.language ? { language: this.opts.language } : {}),
      ...(this.opts.params ?? {}),
    };
    const qs = new URLSearchParams(params).toString();
    const url = `${DEEPGRAM_BASE}?${qs}`;

    // Deepgram browser auth: use protocol header `token, <jwt>`.
    const ws = new WebSocket(url, ['token', this.opts.sessionToken]);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('deepgram_ws_failed')), { once: true });
    });

    ws.addEventListener('message', (ev) => this.handleEvent(ev.data));
    ws.addEventListener('close', () => {
      this.closed = true;
      this.emit({ type: 'closed' });
    });

    const mic =
      this.opts.micStream ??
      (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
    this.mic = mic;

    // Pick the most compatible mime; Deepgram accepts most container hints.
    const mime = pickRecorderMime();
    this.recorder = new MediaRecorder(mic, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = async (e) => {
      if (e.data.size === 0 || ws.readyState !== WebSocket.OPEN) return;
      const buf = await e.data.arrayBuffer();
      ws.send(buf);
    };
    // 250ms chunking gives a good latency/CPU tradeoff for nova-3.
    this.recorder.start(250);
  }

  push(chunk: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk);
  }

  async end(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.recorder?.state !== 'inactive' && this.recorder?.stop();
    } catch {
      /* ignore */
    }
    for (const t of this.mic?.getAudioTracks() ?? []) t.stop();
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Tell Deepgram we're done so it flushes the final transcript.
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws.close();
    }
    this.mic = null;
    this.recorder = null;
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
        /* ignore */
      }
    }
  }

  private handleEvent(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let msg: {
      type?: string;
      channel?: { alternatives?: { transcript?: string }[] };
      is_final?: boolean;
      speech_final?: boolean;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'Results' || (msg.channel && msg.channel.alternatives)) {
      const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (!text) return;
      if (msg.is_final || msg.speech_final) {
        this.emit({ type: 'final', text });
      } else {
        this.emit({ type: 'partial', text });
      }
      return;
    }
    if (msg.type === 'SpeechStarted') this.emit({ type: 'speaking', value: true });
    if (msg.type === 'UtteranceEnd') this.emit({ type: 'speaking', value: false });
  }
}

function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

export const DeepgramNova3Provider: STTProvider = {
  kind: 'stt',
  id: 'deepgram-nova3',
  async open(opts) {
    const stream = new DeepgramSttStream(opts as DeepgramOpenOpts);
    await stream.open();
    return stream;
  },
};

export function registerDeepgramNova3(): void {
  registerVoiceProvider(DeepgramNova3Provider);
}
