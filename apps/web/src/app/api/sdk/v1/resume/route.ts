/**
 * SDK v1 — GET /api/sdk/v1/resume
 *
 * Bearer auth (`recall:read` scope). Returns the data the /resume page
 * shows for `since=3d|3w|3m`: per-project latest briefing + smallest-next-
 * step paragraph, momentum, last-meaningful-activity. Lets external clients
 * (mobile, companion, vscode-ext, browser-ext) render "where to start"
 * natively without scraping the web UI.
 *
 * Optional query params:
 *   - `since` ('3d' | '3w' | '3m'). Default: auto-detect from latest
 *     timeline event (>21d → 3m, >3d → 3w, else 3d).
 *   - `limit` (default 5, max 20)
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { listRecentBriefings } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

const querySchema = z.object({
  since: z.enum(['3d', '3w', '3m']).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

const WINDOW_DAYS = { '3d': 3, '3w': 21, '3m': 90 } as const;

function autoWindow(lastAt: Date | null): '3d' | '3w' | '3m' {
  if (!lastAt) return '3m';
  const ageDays = (Date.now() - lastAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 21) return '3m';
  if (ageDays > 3) return '3w';
  return '3d';
}

function nextStepParagraph(briefing: string): string {
  const paras = briefing
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paras[paras.length - 1] ?? briefing.trim();
  return last.length > 600 ? last.slice(0, 597).replace(/\s+\S*$/, '') + '…' : last;
}

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'recall:read')) return forbidden();

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  let since = parsed.data.since;
  if (!since) {
    const [latest] = await db
      .select({ at: timelineEvent.occurredAt })
      .from(timelineEvent)
      .where(eq(timelineEvent.workspaceId, session.workspaceId))
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(1);
    since = autoWindow(latest?.at ?? null);
  }

  const windowDays = WINDOW_DAYS[since];
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const briefings = await listRecentBriefings(session.workspaceId, parsed.data.limit);

  const [{ count: timelineEventCount = 0 } = {}] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, session.workspaceId),
        gte(timelineEvent.occurredAt, cutoff),
      ),
    );

  return NextResponse.json({
    ok: true,
    since,
    windowDays,
    windowStart: cutoff.toISOString(),
    timelineEventCount: Number(timelineEventCount),
    briefings: briefings.map((b) => ({
      id: b.id,
      projectId: b.projectId,
      projectName: b.projectName,
      momentumScore: b.momentumScore,
      generatedAt: b.generatedAt.toISOString(),
      nextStep: nextStepParagraph(b.briefing),
      briefing: b.briefing,
    })),
  });
}
