/**
 * Audio transcription via Google Cloud Speech-to-Text.
 * Falls back to OpenAI Whisper if Google STT fails or isn't configured.
 */
import speech from '@google-cloud/speech';
import { log } from '@metu/logger';

const client = new speech.SpeechClient();

/**
 * Reject URLs that point at loopback / link-local / private / metadata
 * services. The worker is downloading user-supplied URLs (signed GCS
 * URLs in the happy path) — if a buggy or compromised caller passes
 * `http://169.254.169.254/...`, the worker would happily fetch GCE
 * instance metadata and base64 it into the STT request.
 *
 * Mirrors `apps/web/src/lib/safe-equal.ts#assertSafeOutboundUrl` and
 * `packages/integrations/src/mcp/index.ts#assertSafeMcpUrl`.
 */
function assertSafeAudioUrl(raw: string): URL {
  const url = new URL(raw);
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${protocol}`);
  }
  if (process.env.NODE_ENV === 'production' && protocol === 'http:') {
    throw new Error('only https:// is allowed in production');
  }
  const host = url.hostname.toLowerCase();
  const allowLocalhost = process.env.NODE_ENV !== 'production';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    if (!allowLocalhost) throw new Error('loopback not allowed');
    return url;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224
    ) {
      throw new Error('private or reserved IP not allowed');
    }
  }
  return url;
}

export async function transcribeFromUrl(input: { url: string; language?: string }) {
  if (!input?.url) throw new Error('url required');
  const safeUrl = assertSafeAudioUrl(input.url);

  // Download into memory (capped at ~25MB; for larger, switch to streaming)
  const res = await fetch(safeUrl);
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  try {
    const [response] = await client.recognize({
      audio: { content: buf.toString('base64') },
      config: {
        encoding: 'WEBM_OPUS',
        languageCode: input.language ?? 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',
      },
    });
    const text = (response.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .trim();
    return { text, source: 'google' as const };
  } catch (err) {
    log.warn('worker.stt.google_failed_fallback_whisper', undefined, err);
  }

  // Fallback 1: codai gateway (Whisper-compatible /v1/audio/transcriptions,
  // Azure-backed). Preferred over direct OpenAI: one bill, one key, and the
  // gateway's usage accounting. Configure with CODAI_API_KEY (+ optional
  // CODAI_BASE_URL override).
  if (process.env.CODAI_API_KEY) {
    try {
      const base = (process.env.CODAI_BASE_URL ?? 'https://ai.codai.ro/v1').replace(/\/+$/, '');
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'audio/webm' }), 'audio.webm');
      fd.append('model', 'codai-transcribe');
      if (input.language) fd.append('language', input.language);
      const r = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CODAI_API_KEY}` },
        body: fd,
      });
      if (!r.ok) throw new Error(`codai transcription failed ${r.status}`);
      const json = (await r.json()) as { text: string };
      return { text: json.text, source: 'codai' as const };
    } catch (err) {
      log.warn('worker.stt.codai_failed_fallback_whisper', undefined, err);
    }
  }

  // Fallback 2: OpenAI Whisper via REST
  if (!process.env.OPENAI_API_KEY) throw new Error('No transcription provider available');
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/webm' }), 'audio.webm');
  fd.append('model', 'whisper-1');
  if (input.language) fd.append('language', input.language);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd,
  });
  if (!r.ok) throw new Error(`Whisper failed ${r.status}`);
  const json = (await r.json()) as { text: string };
  return { text: json.text, source: 'openai' as const };
}
