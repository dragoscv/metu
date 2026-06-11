/**
 * SDK v1 — POST /api/sdk/v1/companion/activity
 *
 * Jarvis Slice B — the companion's distiller ships ambient-activity
 * SUMMARIES here (never raw frames/OCR — those stay in the device's local
 * activity.db). Each summary is indexed into workspace memory so the
 * Conductor and "catch me up" recall what the user actually worked on.
 *
 * Scope: `capture:write` (same trust domain as captures — text the user's
 * device chose to remember).
 */
import { type NextRequest, NextResponse } from 'next/server';
import { ActivitySummarySchema } from '@metu/protocol';
import { indexMemory } from '@metu/core/memory';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const parsed = ActivitySummarySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const s = parsed.data;

  const header = [
    `Desktop activity (${s.kind})`,
    s.projectGuess ? `project: ${s.projectGuess}` : null,
    `class: ${s.activityClass}`,
    s.apps.length ? `apps: ${s.apps.join(', ')}` : null,
    `${new Date(s.startTs).toISOString()} → ${new Date(s.endTs).toISOString()}`,
  ]
    .filter(Boolean)
    .join(' · ');

  await indexMemory({
    workspaceId: session.workspaceId,
    sourceKind: 'capture',
    content: `${header}\n\n${s.summary}`,
    metadata: {
      origin: 'companion-activity',
      kind: s.kind,
      activityClass: s.activityClass,
      projectGuess: s.projectGuess ?? null,
      startTs: s.startTs,
      endTs: s.endTs,
    },
  });

  // Mutating SDK routes emit conductor/observe so the Conductor can plan
  // with fresh context (e.g. notice a stuck debugging session).
  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'companion.activity',
      payload: {
        kind: s.kind,
        activityClass: s.activityClass,
        projectGuess: s.projectGuess ?? null,
        apps: s.apps.slice(0, 5),
        source: session.clientId ?? 'companion',
      },
    },
  });

  return NextResponse.json({ ok: true });
}
