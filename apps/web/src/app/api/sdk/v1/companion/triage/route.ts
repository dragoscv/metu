/**
 * SDK v1 — POST /api/sdk/v1/companion/triage
 *
 * Shadow-triage endpoint for the realtime voice lane. The full-duplex
 * realtime providers (OpenAI/Anthropic Realtime) handle the spoken
 * answer themselves; this endpoint runs only the triage classifier on
 * the user's transcript and, when it lands on `escalate`, fires a
 * `conductor/tick` event so the heavy Conductor catches the follow-up
 * (creating tasks, sending emails, scheduling, etc.) in parallel.
 *
 * Cheap by design — no respondLocal, no token generation, no TTS, no
 * voice-cap check. Heuristics short-circuit most calls; the classifier
 * fallback uses the cheapest `intent:'fast'` model.
 *
 * Body:
 *   {
 *     personaSlug: string,
 *     utterance: string,
 *     history?: [{role, content}],
 *     eagerness?: number (0-100),
 *     surface?: 'companion' | 'mobile' | 'web' | 'vscode' | 'browser'
 *   }
 *
 * Response:
 *   { ok: true, escalated: boolean, triage: TriageDecision, eventId?: string }
 */
import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';
import { companionAgent } from '@metu/core';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { log } from '@/lib/logger';
import { inngest } from '@/inngest/client';

export const maxDuration = 30;

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

  // Lighter limiter — triage is fire-and-forget from realtime.
  const limited = await rateLimit('companion-skill', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const input = {
    workspaceId: session.workspaceId,
    userId: session.userId,
    personaSlug: parsed.data.personaSlug,
    utterance: parsed.data.utterance,
    history: parsed.data.history ?? [],
    eagerness: parsed.data.eagerness ?? 50,
    surface: parsed.data.surface ?? 'companion',
  };

  const triage = await companionAgent.triageTurn(input);

  if (triage.lane !== 'escalate') {
    return NextResponse.json({ ok: true, escalated: false, triage });
  }

  let eventId: string | undefined;
  try {
    const sent = await inngest.send({
      name: 'conductor/tick',
      data: {
        workspaceId: input.workspaceId,
        reason: `companion-agent shadow-escalate: ${triage.reason} | utterance="${input.utterance.slice(0, 200)}"`,
      },
    });
    eventId = sent.ids[0];
  } catch (err) {
    // Conductor backlog should never break the realtime conversation —
    // log and continue.
    log.error(
      'companion_triage.inngest_send_failed',
      {
        workspaceId: input.workspaceId,
      },
      err,
    );
  }

  return NextResponse.json({ ok: true, escalated: true, triage, eventId });
}
