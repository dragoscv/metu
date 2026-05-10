/**
 * SDK v1 — POST /api/sdk/v1/companion/turn/stream
 *
 * Streaming twin of `/companion/turn`. Emits NDJSON lines:
 *   {"type":"triage", triage:{...}}
 *   {"type":"ack", text:"..."}              // escalate path only
 *   {"type":"escalated", eventId?, triage}  // escalate path terminator
 *   {"type":"delta", text:"..."}            // local streaming
 *   {"type":"final", text:"...", toolCallNames:[...], triage}
 *   {"type":"error", message:"..."}         // terminal
 *
 * Used by `apps/companion` pipeline lane so the realtime UI can start
 * speaking the first sentence as soon as the model emits it, while the
 * orchestrator still gets the chance to short-circuit to the Conductor.
 */
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { companionAgent } from '@metu/core';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  personaSlug: z.string().min(1).max(80),
  utterance: z.string().min(1).max(4_000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4_000),
      }),
    )
    .max(20)
    .optional(),
  eagerness: z.number().int().min(0).max(100).optional(),
  surface: z.enum(['companion', 'mobile', 'web', 'vscode', 'browser', 'telegram']).optional(),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return new Response(
      JSON.stringify({
        type: 'error',
        message: 'voice_cap_exceeded',
        spent: cap.state.spentUsd,
        cap: cap.state.capUsd,
      }) + '\n',
      { status: 402, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ type: 'error', message: parsed.error.issues[0]?.message ?? 'invalid' }) +
        '\n',
      { status: 400, headers: { 'content-type': 'application/x-ndjson' } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      try {
        for await (const ev of companionAgent.streamCompanionTurn(
          {
            workspaceId: session.workspaceId,
            userId: session.userId,
            personaSlug: parsed.data.personaSlug,
            utterance: parsed.data.utterance,
            history: parsed.data.history ?? [],
            eagerness: parsed.data.eagerness ?? 50,
            surface: parsed.data.surface ?? 'companion',
          },
          {
            onEscalate: async (input, reason) => {
              const sent = await inngest.send({
                name: 'conductor/tick',
                data: {
                  workspaceId: input.workspaceId,
                  reason: `companion-agent escalate: ${reason} | utterance="${input.utterance.slice(0, 200)}"`,
                },
              });
              return sent.ids[0];
            },
          },
        )) {
          send(ev);
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
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
