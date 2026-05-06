/**
 * Audio transcription via Google Cloud Speech-to-Text.
 * Falls back to OpenAI Whisper if Google STT fails or isn't configured.
 */
import speech from '@google-cloud/speech';

const client = new speech.SpeechClient();

export async function transcribeFromUrl(input: { url: string; language?: string }) {
  if (!input?.url) throw new Error('url required');

  // Download into memory (capped at ~25MB; for larger, switch to streaming)
  const res = await fetch(input.url);
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
    console.warn('[worker] Google STT failed, falling back to Whisper', err);
  }

  // Fallback: OpenAI Whisper via REST
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
