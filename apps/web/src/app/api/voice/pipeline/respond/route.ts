/**
 * POST /api/voice/pipeline/respond
 *
 * Pipeline-lane LLM step. Takes a user transcript + persona slug, runs the
 * model with the persona's system prompt, and streams plain-text deltas back
 * via SSE-ish framing (each chunk is a JSON line:
 *   {"type":"delta","text":"…"}
 *   {"type":"final","text":"<full>"}).
 *
 * The client (companion `pipelineSession`) consumes deltas to drive a
 * sentence-buffered TTS feed — so the user starts hearing the answer before
 * the LLM finishes generating.
 *
 * No tool use here — Conductor tool-calling lives in the dedicated
 * /api/conductor/chat path. Pipeline voice is voice-to-voice only for v1.
 */
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { streamText, type ModelMessage } from 'ai';
import { auth } from '@metu/auth';
import { getModel } from '@metu/ai';
import { getBuiltInPersona } from '@metu/presence';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  personaSlug: z.string().min(1).max(80),
  transcript: z.string().min(1).max(4_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4_000),
      }),
    )
    .max(20)
    .default([]),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.workspaceId) {
    return new Response('unauthenticated', { status: 401 });
  }
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? 'invalid', { status: 400 });
  }
  const persona = getBuiltInPersona(parsed.data.personaSlug);
  if (!persona) return new Response('persona_not_found', { status: 404 });

  let model;
  try {
    const resolved = await getModel({
      workspaceId: session.user.workspaceId,
      intent: 'fast',
    });
    model = resolved.model;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: 'no_model', detail: msg }), {
      status: 412,
      headers: { 'content-type': 'application/json' },
    });
  }

  const messages: ModelMessage[] = [
    ...parsed.data.history.map((m): ModelMessage => ({ role: m.role, content: m.content })),
    { role: 'user', content: parsed.data.transcript },
  ];

  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: persona.systemPrompt,
    messages,
    // Pipeline mode is text-only; cap output so TTS stays snappy.
    maxOutputTokens: 600,
  });

  // Hand-rolled NDJSON stream — keeps the client parser trivial in the
  // companion's WebView (no AI SDK runtime dep on that side).
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let final = '';
      try {
        for await (const delta of result.textStream) {
          final += delta;
          controller.enqueue(encoder.encode(JSON.stringify({ type: 'delta', text: delta }) + '\n'));
        }
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'final', text: final }) + '\n'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'error', message: msg }) + '\n'));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    },
  });
}
