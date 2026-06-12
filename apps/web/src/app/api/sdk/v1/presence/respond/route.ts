/**
 * SDK v1 — POST /api/sdk/v1/presence/respond
 *
 * Bearer auth (`presence:talk` scope). Persona-aware text response. Body:
 *   { personaSlug, transcript, history?: [{role, content}] }
 * Streams NDJSON lines: `{"type":"delta","text":"…"}` then
 * `{"type":"final","text":"<full>"}`. No tool use — that's the Conductor
 * chat path. This is the mobile/voice-only fast lane.
 *
 * Mirrors the cookie-auth `/api/voice/pipeline/respond` route (slice 5)
 * but bearer-friendly so external clients can drive it.
 */
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { streamText, type ModelMessage } from 'ai';
import { getModel } from '@metu/ai';
import { getBuiltInPersona } from '@metu/presence';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

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
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

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
      workspaceId: session.workspaceId,
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
    maxOutputTokens: 600,
  });

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
