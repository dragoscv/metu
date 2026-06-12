/**
 * POST /api/voice/transcribe
 *
 * Push-to-talk endpoint for the web composer. Accepts a multipart/form-data
 * upload with a single `file` field (audio blob recorded via
 * MediaRecorder) and returns the Whisper transcript. Uses the workspace's
 * BYOK OpenAI key.
 *
 * Auth: session cookie. Rate-limited to deter accidental loops or
 * malicious enumeration. The Whisper call itself costs ~$0.006/min so
 * a rogue client could rack up real money.
 */
import { NextResponse } from 'next/server';
import { auth } from '@metu/auth';
import { getProviderCredential } from '@metu/ai';
import { rateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/logger';

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI hard limit
const FETCH_TIMEOUT_MS = 30_000;
const OPENAI_AUDIO_URL = 'https://api.openai.com/v1/audio/transcriptions';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const workspaceId = session.user.workspaceId;
  const userId = session.user.id;

  // 30 transcribe calls / minute / user. Plenty for human push-to-talk
  // (each call is a discrete utterance), pinches automated abuse.
  const rateLimitResponse = await rateLimit('voice-transcribe', userId);
  if (rateLimitResponse) return rateLimitResponse;

  const cred = await getProviderCredential(workspaceId, 'openai');
  if (!cred) {
    return NextResponse.json({ error: 'openai_credential_missing' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'invalid_size' }, { status: 400 });
  }

  const language = (form.get('language') as string | null) ?? undefined;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstreamForm = new FormData();
    upstreamForm.set('model', 'whisper-1');
    if (language) upstreamForm.set('language', language);
    upstreamForm.set(
      'file',
      file,
      // Whisper looks at the filename extension to detect the format.
      // MediaRecorder defaults to webm/opus; we hint that explicitly.
      'recording.webm',
    );

    const stt = await fetch(OPENAI_AUDIO_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${cred.apiKey}` },
      body: upstreamForm,
      signal: ac.signal,
    });
    if (!stt.ok) {
      const body = await stt.text().catch(() => '');
      log.warn('voice.transcribe.upstream_failed', {
        workspaceId,
        userId,
        status: stt.status,
        bodySnippet: body.slice(0, 200),
      });
      return NextResponse.json({ error: 'upstream_failed', status: stt.status }, { status: 502 });
    }
    const json = (await stt.json()) as { text?: string; language?: string };
    if (!json.text) {
      return NextResponse.json({ error: 'empty_transcript' }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      text: json.text.trim(),
      language: json.language ?? null,
    });
  } catch (err) {
    log.error('voice.transcribe.failed', { workspaceId, userId }, err);
    return NextResponse.json({ error: 'transcribe_failed' }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
}
