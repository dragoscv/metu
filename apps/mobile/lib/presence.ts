/**
 * Mobile Presence loop — talk-to-persona over the bearer SDK.
 *
 * Each turn:
 *   1. uploadAudio() POSTs the recorded blob (m4a/webm) to
 *      /api/sdk/v1/presence/transcribe and resolves to `{text}`.
 *   2. streamRespond() POSTs `{personaSlug, transcript, history}` to
 *      /api/sdk/v1/presence/respond and parses the NDJSON stream, calling
 *      `onDelta` for every chunk and resolving with the final text.
 *   3. fetchTtsBlob() POSTs `{personaSlug, text}` to
 *      /api/sdk/v1/presence/speak and returns an mp3 blob the caller can
 *      hand to `expo-av` for playback.
 *
 * Shape kept dumb on purpose — wake-word (slice 9b) and on-device STT
 * fallback will plug into the same pipeline.
 */
import { getToken } from './api';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://app.metu.ro';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function uploadAudio(
  uri: string,
  mime: string,
  language?: string,
): Promise<{ text: string }> {
  // React Native's FormData expects {uri, name, type} for file fields. The
  // upload-from-uri form skips the blob round-trip entirely, which matters
  // on iOS where fetch().blob() can be lossy for m4a containers.
  const form = new FormData();
  const fileField = {
    uri,
    name: `utterance.${mime.split('/')[1] ?? 'm4a'}`,
    type: mime,
  } as unknown as Blob;
  form.append('audio', fileField);
  if (language) form.append('language', language);
  const r = await fetch(`${BASE}/api/sdk/v1/presence/transcribe`, {
    method: 'POST',
    headers: { ...(await authHeaders()) },
    body: form,
  });
  if (!r.ok) throw new Error(`transcribe ${r.status}: ${await r.text()}`);
  const json = (await r.json()) as { ok: boolean; text: string };
  if (!json.ok) throw new Error('transcribe_failed');
  return { text: json.text };
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export async function streamRespond(
  personaSlug: string,
  transcript: string,
  history: ChatTurn[],
  onDelta: (chunk: string) => void,
): Promise<string> {
  const r = await fetch(`${BASE}/api/sdk/v1/presence/respond`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ personaSlug, transcript, history }),
  });
  if (!r.ok || !r.body) throw new Error(`respond ${r.status}: ${await r.text()}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let final = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      try {
        const evt = JSON.parse(line) as
          | { type: 'delta'; text: string }
          | { type: 'final'; text: string }
          | { type: 'error'; message: string };
        if (evt.type === 'delta') onDelta(evt.text);
        else if (evt.type === 'final') final = evt.text;
        else if (evt.type === 'error') throw new Error(evt.message);
      } catch {
        // Skip malformed line — server occasionally splits a line across chunks.
      }
    }
  }
  return final;
}

export async function fetchTtsBlob(
  personaSlug: string,
  text: string,
  language?: string,
): Promise<Blob> {
  const r = await fetch(`${BASE}/api/sdk/v1/presence/speak`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ personaSlug, text, language }),
  });
  if (!r.ok) throw new Error(`speak ${r.status}: ${await r.text()}`);
  return r.blob();
}

// ─── Companion-Agent two-tier orchestrator (slice 8) ───────────────────────

export type CompanionTurnResponse =
  | {
      ok: true;
      kind: 'local';
      text: string;
      triage: { lane: 'local'; reason: string; source: string };
      toolCallNames: string[];
      capWarn?: boolean;
    }
  | {
      ok: true;
      kind: 'escalated';
      ack: string;
      eventId?: string;
      triage: { lane: 'escalate'; reason: string; source: string };
      capWarn?: boolean;
    };

/**
 * Single-shot orchestrator call. Triages the utterance and either returns
 * a fast-lane text answer or an immediate ack while the heavy Conductor
 * picks it up. Caller speaks `text` (local) or `ack` (escalated) right
 * away; the Conductor's eventual reply arrives later via push notification.
 */
export async function companionTurn(
  personaSlug: string,
  utterance: string,
  history: ChatTurn[],
  opts: {
    eagerness?: number;
    surface?: 'mobile' | 'companion' | 'web';
  } = {},
): Promise<CompanionTurnResponse> {
  const r = await fetch(`${BASE}/api/sdk/v1/companion/turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      personaSlug,
      utterance,
      history,
      eagerness: opts.eagerness,
      surface: opts.surface ?? 'mobile',
    }),
  });
  if (!r.ok) throw new Error(`companion-turn ${r.status}: ${await r.text()}`);
  return (await r.json()) as CompanionTurnResponse;
}
