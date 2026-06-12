/**
 * Codai realtime voice adapter — Gemini Live via the codai gateway relay.
 *
 * Transport: plain WebSocket to `wss://ai.codai.ro/v1/realtime` (the gateway
 * relays to Vertex's BidiGenerateContent and handles Google auth; the client
 * only needs a codai API key). Protocol is the standard Gemini Live shape:
 *
 *   -> { setup: { generationConfig, systemInstruction?, ... } }
 *   <- { setupComplete: {...} }
 *   -> { realtimeInput: { audio: { mimeType, data } } }       (mic PCM16)
 *   -> { clientContent: { turns: [...], turnComplete: true } } (text turn)
 *   <- { serverContent: { modelTurn: { parts: [{ inlineData }] },
 *        inputTranscription?, outputTranscription?, turnComplete? } }
 *
 * Unlike openai-realtime (WebRTC + ephemeral broker token), this adapter
 * takes the session token AS the WS auth (?key=) — the web broker mints a
 * short-lived scoped codai key, or passes the workspace's codai key for
 * trusted runtimes (companion/desktop).
 *
 * Audio: input 16-bit PCM @16kHz mono base64; output 16-bit PCM @24kHz.
 * The session emits raw output chunks via the `audio` event-like callback
 * channel (VoiceSessionEvent has no audio variant in v1, so playback is
 * wired through `onAudio` in the open opts — mirrors how pipeline TTS
 * returns chunks rather than events).
 */
import { registerVoiceProvider } from './registry';
import type {
  Off,
  RealtimeOpenOpts,
  RealtimeProvider,
  RealtimeSession,
  VoiceSessionEvent,
} from './types';

const DEFAULT_URL = 'wss://ai.codai.ro/v1/realtime';
const DEFAULT_MODEL = 'codai-voice';

export interface CodaiRealtimeOpts extends RealtimeOpenOpts {
  /** Relay URL override (self-hosted gateways / staging). */
  url?: string;
  /** Model id (default codai-voice → gemini-live-2.5-flash-native-audio). */
  model?: string;
  /** System instruction for the voice persona. */
  instructions?: string;
  /** BCP-47 language hint (e.g. 'ro-RO'). */
  language?: string;
  /** Output audio sink — called with 24kHz 16-bit PCM chunks as they
   *  stream. Playback is the caller's concern (AudioWorklet etc.). */
  onAudio?: (pcm: Uint8Array) => void;
}

class CodaiRealtimeSession implements RealtimeSession {
  private ws: WebSocket | null = null;
  private listeners = new Set<(ev: VoiceSessionEvent) => void>();
  private opts: CodaiRealtimeOpts;
  private paused = false;
  private speaking = false;

  constructor(opts: CodaiRealtimeOpts) {
    this.opts = opts;
  }

  on(cb: (ev: VoiceSessionEvent) => void): Off {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(ev: VoiceSessionEvent): void {
    for (const cb of this.listeners) cb(ev);
  }

  async start(): Promise<void> {
    const url = new URL(this.opts.url ?? DEFAULT_URL);
    url.searchParams.set('key', this.opts.sessionToken);
    url.searchParams.set('model', this.opts.model ?? DEFAULT_MODEL);

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const fail = (msg: string) => {
        reject(new Error(msg));
      };
      ws.onerror = () => fail('codai realtime: connection failed');
      ws.onclose = (e) => fail(`codai realtime: closed during setup (${e.code})`);
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            setup: {
              generationConfig: {
                responseModalities: ['AUDIO'],
                ...(this.opts.language
                  ? { speechConfig: { languageCode: this.opts.language } }
                  : {}),
              },
              ...(this.opts.instructions
                ? { systemInstruction: { parts: [{ text: this.opts.instructions }] } }
                : {}),
              // Transcribe both directions so the UI can render captions.
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          }),
        );
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as {
            setupComplete?: unknown;
          };
          if (msg.setupComplete) {
            this.bindStreamHandlers(ws);
            resolve();
          }
        } catch {
          /* binary or non-JSON before setup — ignore */
        }
      };
    });
  }

  private bindStreamHandlers(ws: WebSocket): void {
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: {
        serverContent?: {
          modelTurn?: { parts?: Array<{ inlineData?: { data?: string }; text?: string }> };
          inputTranscription?: { text?: string };
          outputTranscription?: { text?: string };
          turnComplete?: boolean;
          interrupted?: boolean;
        };
      };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const sc = msg.serverContent;
      if (!sc) return;

      if (sc.inputTranscription?.text) {
        this.emit({ type: 'partial', text: sc.inputTranscription.text });
      }
      if (sc.outputTranscription?.text) {
        // Model speech transcription — surfaced as partial agent text.
        this.emit({ type: 'partial', text: sc.outputTranscription.text });
      }
      for (const part of sc.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && this.opts.onAudio) {
          if (!this.speaking) {
            this.speaking = true;
            this.emit({ type: 'speaking', value: true });
          }
          const bin = atob(part.inlineData.data);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          this.opts.onAudio(bytes);
        }
      }
      if (sc.turnComplete || sc.interrupted) {
        if (this.speaking) {
          this.speaking = false;
          this.emit({ type: 'speaking', value: false });
        }
        if (sc.turnComplete) this.emit({ type: 'final', text: '' });
      }
    };
    ws.onclose = () => this.emit({ type: 'closed' });
    ws.onerror = () => this.emit({ type: 'error', message: 'codai realtime socket error' });
  }

  pushAudio(chunk: ArrayBuffer): void {
    if (this.paused || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    // Gemini Live expects base64 PCM16 @16kHz in realtimeInput frames.
    const bytes = new Uint8Array(chunk);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { mimeType: 'audio/pcm;rate=16000', data: btoa(bin) },
        },
      }),
    );
  }

  /** Send a text turn (quick-capture style input alongside voice). */
  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        },
      }),
    );
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  interrupt(): void {
    // Gemini Live handles barge-in server-side via VAD when new audio
    // arrives; an explicit client interrupt is just an empty audio turn
    // boundary. Emit local state so the UI stops the speaking indicator.
    if (this.speaking) {
      this.speaking = false;
      this.emit({ type: 'speaking', value: false });
    }
  }

  async stop(): Promise<void> {
    this.ws?.close(1000, 'client stop');
    this.ws = null;
  }
}

export const codaiRealtimeProvider: RealtimeProvider = {
  kind: 'realtime',
  id: 'codai-realtime',
  async open(opts: RealtimeOpenOpts): Promise<RealtimeSession> {
    return new CodaiRealtimeSession(opts as CodaiRealtimeOpts);
  },
};

registerVoiceProvider(codaiRealtimeProvider);
