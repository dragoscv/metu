/**
 * SDK v1 — POST /api/sdk/v1/companion/turn
 *
 * Companion-Agent slice 8 entry. Bearer auth (`presence:talk` scope).
 * Drives the two-tier reactive loop: triages the utterance → either
 * returns text from the local fast lane OR escalates to the heavy
 * Conductor and returns an immediate spoken acknowledgement.
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
 * Response (always JSON, single shot — no streaming for now since the
 * orchestrator may escalate without producing tokens):
 *   { kind: 'local',     text, triage, toolCallNames }
 *   { kind: 'escalated', ack,  triage, eventId? }
 */
import { z } from 'zod';
import { type NextRequest, NextResponse } from 'next/server';
import { companionAgent } from '@metu/core';
import { loadPromptContext } from '@/lib/prompt-context';
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
  /** Ambient on-screen context from the companion sense engine (text only). */
  screenContext: z.string().max(6_000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('companion-skill', session.userId);
  if (limited) return limited;

  // Local-lane LLM is metered too; treat the turn as voice spend so the
  // cap protects users from runaway costs even without speak/transcribe.
  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: 'voice_cap_exceeded',
        spent: cap.state.spentUsd,
        cap: cap.state.capUsd,
      },
      { status: 402 },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const promptContext = await loadPromptContext({
    workspaceId: session.workspaceId,
    userId: session.userId,
    personaSlug: parsed.data.personaSlug,
  });

  const result = await companionAgent.runCompanionTurn(
    {
      workspaceId: session.workspaceId,
      userId: session.userId,
      personaSlug: parsed.data.personaSlug,
      utterance: parsed.data.utterance,
      history: parsed.data.history ?? [],
      eagerness: parsed.data.eagerness ?? 50,
      surface: parsed.data.surface ?? 'companion',
      promptContext,
      screenContext: parsed.data.screenContext,
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
  );

  // Observe — fire-and-forget. The conductor's onConductorObserve handler
  // writes a timeline_event so local turns show up in the audit feed even
  // though they don't escalate.
  void inngest
    .send({
      name: 'conductor/observe',
      data: {
        workspaceId: session.workspaceId,
        eventKind: `companion-agent.${result.kind}`,
        payload: {
          surface: parsed.data.surface ?? 'companion',
          personaSlug: parsed.data.personaSlug,
          eagerness: parsed.data.eagerness ?? 50,
          triage: result.triage,
          ...(result.kind === 'local'
            ? { toolCallNames: result.toolCallNames }
            : { eventId: result.eventId }),
        },
      },
    })
    .catch(() => {});

  return NextResponse.json({ ok: true, capWarn: cap.state.soft, ...result });
}
