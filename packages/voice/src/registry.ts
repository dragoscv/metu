/**
 * Provider registry — adapters plug themselves in at module load time.
 *
 * Slice 1 ships the registry shell empty. Slices 4–5 register the actual
 * adapters on the correct runtime (companion webview, mobile native, web).
 */
import type {
  AnyVoiceProvider,
  RealtimeProvider,
  RealtimeProviderId,
  STTProvider,
  STTProviderId,
  TTSProvider,
  TTSProviderId,
  WakeProviderId,
  WakeWordProvider,
} from './types';

const realtime = new Map<string, RealtimeProvider>();
const stt = new Map<string, STTProvider>();
const tts = new Map<string, TTSProvider>();
const wake = new Map<string, WakeWordProvider>();

export function registerVoiceProvider(p: AnyVoiceProvider): void {
  switch (p.kind) {
    case 'realtime':
      realtime.set(p.id, p);
      return;
    case 'stt':
      stt.set(p.id, p);
      return;
    case 'tts':
      tts.set(p.id, p);
      return;
    case 'wake':
      wake.set(p.id, p);
      return;
  }
}

export function getRealtime(id: RealtimeProviderId): RealtimeProvider | null {
  return realtime.get(id) ?? null;
}
export function getSTT(id: STTProviderId): STTProvider | null {
  return stt.get(id) ?? null;
}
export function getTTS(id: TTSProviderId): TTSProvider | null {
  return tts.get(id) ?? null;
}
export function getWake(id: WakeProviderId): WakeWordProvider | null {
  return wake.get(id) ?? null;
}

export function listVoiceProviders(): {
  realtime: string[];
  stt: string[];
  tts: string[];
  wake: string[];
} {
  return {
    realtime: [...realtime.keys()],
    stt: [...stt.keys()],
    tts: [...tts.keys()],
    wake: [...wake.keys()],
  };
}
