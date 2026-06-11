/**
 * SDK v1 — POST /api/sdk/v1/companion/skill
 *
 * Direct skill lane for avatar quick actions (Jarvis perf pass). Unlike
 * /companion/turn* there is NO triage, NO tool loop, NO Conductor handoff:
 * the companion sends a skill id + the locally-gathered context (activity
 * timeline, OCR text — already privacy-gated on device) and gets a single
 * streamed completion on the `fast` intent. Predictable 2–4s end-to-end.
 *
 * Streams plain text chunks (text/plain; charset=utf-8) — the client
 * renders them straight into the bubble as they arrive.
 */
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { streamText } from 'ai';
import { getModel } from '@metu/ai';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SKILLS: Record<string, { system: string; maxOutputTokens: number }> = {
  catch_up: {
    system: `You are the user's desktop assistant. Given their recent activity timeline and screen text, write a tight, friendly catch-up: what they were working on, where they left off, and the obvious next step. 2-4 short sentences. No preamble, no headers.`,
    maxOutputTokens: 220,
  },
  analyze_screen: {
    system: `You are the user's desktop assistant looking at their screen via extracted text. Describe what they're working on and point out anything notable (errors, TODOs, unfinished thoughts). Be concrete — quote the actual content. 2-5 short sentences. If the screen text is empty, say you can't see anything useful and suggest enabling watching.`,
    maxOutputTokens: 280,
  },
  explain_error: {
    system: `You are the user's debugging assistant. The screen text contains an error. Identify it, explain the likely cause in one sentence, and give the most probable fix. Be specific to THEIR error, not generic advice. 2-5 short sentences or a tiny code snippet.`,
    maxOutputTokens: 320,
  },
  whats_next: {
    system: `You are the user's desktop assistant. From their recent activity, suggest the single most valuable next action and one alternative. Direct and brief — 2-3 sentences.`,
    maxOutputTokens: 180,
  },
};

const Body = z.object({
  skill: z.enum(['catch_up', 'analyze_screen', 'explain_error', 'whats_next']),
  /** Locally-gathered context (timeline summary, OCR text). Text only. */
  context: z.string().max(12_000).default(''),
  personaSlug: z.string().min(1).max(80).default('atlas'),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return new Response('Budget reached for this workspace.', { status: 402 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? 'invalid', { status: 400 });
  }
  const skill = SKILLS[parsed.data.skill]!;

  const { model } = await getModel({ workspaceId: session.workspaceId, intent: 'fast' });
  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: skill.system,
    prompt: parsed.data.context || '(no context available)',
    maxOutputTokens: skill.maxOutputTokens,
  });

  return result.toTextStreamResponse();
}
