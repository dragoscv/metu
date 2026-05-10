/**
 * Minimal Whisper transcription helper for server-side surfaces
 * (Telegram voice messages, future webhook captures).
 *
 * Uses the workspace's BYOK OpenAI key. Returns null on any failure
 * so callers can fall back gracefully — they're not required-path.
 */
import { getProviderCredential } from '@metu/ai';
import { assertSafeOutboundUrl } from '@/lib/safe-equal';

const OPENAI_AUDIO_URL = 'https://api.openai.com/v1/audio/transcriptions';
const MAX_BYTES = 25 * 1024 * 1024; // OpenAI hard limit
const FETCH_TIMEOUT_MS = 30_000;

export interface TranscribeResult {
  text: string;
  language?: string;
}

export async function transcribeRemoteAudio(
  workspaceId: string,
  audioUrl: string,
  opts: { language?: string; filename?: string } = {},
): Promise<TranscribeResult | null> {
  const cred = await getProviderCredential(workspaceId, 'openai');
  if (!cred) return null;

  try {
    await assertSafeOutboundUrl(audioUrl);
  } catch {
    return null;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const audioRes = await fetch(audioUrl, { signal: ac.signal });
    if (!audioRes.ok) return null;
    const len = Number(audioRes.headers.get('content-length') ?? '0');
    if (len > MAX_BYTES) return null;
    const buf = await audioRes.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return null;

    const form = new FormData();
    form.set('model', 'whisper-1');
    if (opts.language) form.set('language', opts.language);
    form.set(
      'file',
      new Blob([buf], { type: audioRes.headers.get('content-type') ?? 'audio/ogg' }),
      opts.filename ?? 'voice.ogg',
    );

    const stt = await fetch(OPENAI_AUDIO_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.apiKey}` },
      body: form,
      signal: ac.signal,
    });
    if (!stt.ok) return null;
    const json = (await stt.json()) as { text?: string; language?: string };
    if (!json.text) return null;
    return { text: json.text.trim(), language: json.language };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
