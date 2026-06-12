/**
 * @metu/voice — provider-agnostic voice mesh.
 *
 * Slice 1 (foundation): interfaces + provider registry only. Adapters
 * (`openai-realtime`, `deepgram`, `cartesia`, `elevenlabs`, `local-whisper`,
 * `open-wake-word`) land in slices 4–5.
 *
 * Three lanes:
 *   1. Realtime: bidirectional speech-in/speech-out single connection
 *      (e.g. OpenAI gpt-realtime via WebRTC). Barge-in native.
 *   2. Pipeline: STT → LLM → TTS as separate streaming providers, composed
 *      by `pipelineSession()`. Used when LLM is non-OpenAI (Claude, Copilot)
 *      or when persona requests a specific TTS voice unavailable in Realtime.
 *   3. Wake: on-device always-listening detector that fires `onWake()` and
 *      hands off to lane 1 or 2.
 *
 * Token brokerage: sessions never receive raw BYOK keys. The web app's
 * `/api/voice/.../session` route opens sealed credentials and returns either
 * an ephemeral provider session token or a signed websocket URL with TTL.
 */
import { z } from 'zod';

// ─── Shared primitives ────────────────────────────────────────────────────

export type Off = () => void;

export type VoicePersonaTuning = {
  speed?: number;
  stability?: number;
  style?: number;
  pitch?: number;
};

export const VoiceSessionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('partial'), text: z.string() }),
  z.object({ type: z.literal('final'), text: z.string() }),
  z.object({ type: z.literal('speaking'), value: z.boolean() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('closed') }),
]);
export type VoiceSessionEvent = z.infer<typeof VoiceSessionEventSchema>;

// ─── Capability: Realtime (lane 1) ────────────────────────────────────────

export interface RealtimeOpenOpts {
  /** Ephemeral provider session token from the web broker. */
  sessionToken: string;
  /** Optional ICE servers when transport=webrtc. Shape mirrors `RTCIceServer`. */
  iceServers?: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }>;
  /** Persona system prompt (concatenated with user instructions). */
  systemPrompt: string;
  /** Provider voice id (e.g. 'verse'). */
  voiceId: string;
  tuning?: VoicePersonaTuning;
  /** Tool schemas the model may call (Conductor device tools). */
  tools?: Array<{ name: string; description: string; parameters: unknown }>;
  /**
   * Optional render sink for the model's audio track. Typed as `unknown`
   * here so the shared interface stays DOM-free; webview adapters narrow
   * it to `HTMLAudioElement`.
   */
  audioEl?: unknown;
}

export interface RealtimeSession {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  /** Force-stop model speech (barge-in). */
  interrupt(): void;
  stop(): Promise<void>;
  /** Push raw PCM/Opus audio (mic input). */
  pushAudio(chunk: ArrayBuffer): void;
  on(cb: (ev: VoiceSessionEvent) => void): Off;
}

export interface RealtimeProvider {
  kind: 'realtime';
  /** e.g. 'openai-realtime' */
  id: string;
  open(opts: RealtimeOpenOpts): Promise<RealtimeSession>;
}

// ─── Capability: STT (pipeline lane 2a) ───────────────────────────────────

export interface STTOpenOpts {
  sessionToken?: string;
  language?: string;
  /** Hint at expected mime; provider may downsample. */
  inputMime?: 'audio/webm' | 'audio/wav' | 'audio/ogg' | 'audio/pcm';
}

export interface STTStream {
  push(chunk: ArrayBuffer): void;
  end(): Promise<void>;
  on(cb: (ev: VoiceSessionEvent) => void): Off;
}

export interface STTProvider {
  kind: 'stt';
  id: string;
  open(opts: STTOpenOpts): Promise<STTStream>;
}

// ─── Capability: TTS (pipeline lane 2b) ───────────────────────────────────

export interface TTSSpeakOpts {
  sessionToken?: string;
  voiceId: string;
  tuning?: VoicePersonaTuning;
  /** Output format the consumer wants. */
  outputMime?: 'audio/mpeg' | 'audio/opus' | 'audio/pcm' | 'audio/wav';
}

export interface TTSProvider {
  kind: 'tts';
  id: string;
  /** Returns a streaming async iterable of audio chunks. */
  speak(text: string, opts: TTSSpeakOpts): AsyncIterable<Uint8Array>;
}

// ─── Capability: Wake word (lane 3) ───────────────────────────────────────

export interface WakeWordProvider {
  kind: 'wake';
  id: string;
  /**
   * Start listening for the model name (e.g. 'hey-jarvis'). `onWake` fires
   * once per detection. Returns a stop handle.
   */
  start(model: string, onWake: () => void): Promise<Off>;
}

// ─── Provider id catalog (locked v1) ──────────────────────────────────────

export const REALTIME_PROVIDERS = [
  'openai-realtime',
  'anthropic-realtime',
  // Gemini Live via the codai gateway relay (wss://ai.codai.ro/v1/realtime).
  'codai-realtime',
] as const;
export type RealtimeProviderId = (typeof REALTIME_PROVIDERS)[number];

export const STT_PROVIDERS = [
  'deepgram-nova3',
  'openai-whisper-1',
  'openai-4o-mini-transcribe',
  'local-whisper-cpp',
] as const;
export type STTProviderId = (typeof STT_PROVIDERS)[number];

export const TTS_PROVIDERS = [
  'cartesia-sonic-turbo',
  'elevenlabs-flash',
  'deepgram-aura-2',
  'piper-local',
] as const;
export type TTSProviderId = (typeof TTS_PROVIDERS)[number];

export const WAKE_PROVIDERS = ['open-wake-word', 'porcupine'] as const;
export type WakeProviderId = (typeof WAKE_PROVIDERS)[number];

export type AnyVoiceProvider = RealtimeProvider | STTProvider | TTSProvider | WakeWordProvider;
