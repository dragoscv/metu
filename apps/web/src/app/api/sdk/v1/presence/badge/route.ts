/**
 * SDK v1 — GET /api/sdk/v1/presence/badge
 *
 * Bearer auth (`presence:talk` scope). Returns the current privacy badge
 * state (the same shape `getPrivacyBadgeState()` produces for the web
 * settings page) so the companion can mirror the "observing" indicator
 * without polling the web origin directly.
 *
 * Why a GET, not a hub push: the badge is low-frequency and the hub
 * envelope catalogue stays minimal. Companion polls at the same 60s
 * cadence the web page uses; if we ever need lower latency we can add a
 * `presence/observe` envelope and bridge it from the action layer.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { getDb } from '@metu/db';
import { personaActivation, sensoryRing } from '@metu/db/schema';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const db = getDb();
  const since = new Date(Date.now() - 5 * 60 * 1000);

  const [activationCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(personaActivation)
    .where(eq(personaActivation.workspaceId, session.workspaceId));
  const [sensoryCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sensoryRing)
    .where(
      and(eq(sensoryRing.workspaceId, session.workspaceId), gte(sensoryRing.occurredAt, since)),
    );
  const [last] = await db
    .select({ kind: sensoryRing.kind, occurredAt: sensoryRing.occurredAt })
    .from(sensoryRing)
    .where(eq(sensoryRing.workspaceId, session.workspaceId))
    .orderBy(desc(sensoryRing.occurredAt))
    .limit(1);

  return NextResponse.json({
    ok: true,
    observingActivations: activationCount?.n ?? 0,
    recentSensoryCount: sensoryCount?.n ?? 0,
    lastSensoryAt: last?.occurredAt?.toISOString() ?? null,
    lastSensoryKind: last?.kind ?? null,
  });
}
