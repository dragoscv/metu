/**
 * SDK v1 — GET /api/sdk/v1/audit/summary
 *
 * Bearer auth (`audit:read` scope). Returns the same aggregates the
 * `/audit` page header strip + cost panel render, in a stable JSON
 * shape suitable for finance/admin clients (the companion app's
 * "spend today" widget, third-party dashboards, internal scripts).
 *
 * Query params:
 *   - since: `Nd` (default 7d, capped 1..365). Window for all aggregates.
 *   - top:   1..50 (default 5). How many entries to return for `topByCost`.
 *
 * Why a SDK route, not a webhook: pull-based clients want a snapshot
 * on demand. We deliberately do not return per-call rows here — that's
 * what the cookie-only `/api/audit/export` CSV is for.
 */
import { NextResponse } from 'next/server';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import {
  toolCallByAclMode,
  toolCallDailyCost,
  toolCallSummary,
  toolCallTopByCost,
} from '@metu/db/queries';

export const runtime = 'nodejs';

const DEFAULT_SINCE_DAYS = 7;
const MAX_SINCE_DAYS = 365;

function parseSince(raw: string | null): { since: Date; days: number } {
  const m = raw?.match(/^(\d+)d$/);
  const requested = m ? Number(m[1]) : DEFAULT_SINCE_DAYS;
  const days = Math.min(Math.max(requested, 1), MAX_SINCE_DAYS);
  return { since: new Date(Date.now() - days * 24 * 60 * 60 * 1000), days };
}

function parseTop(raw: string | null): number {
  const n = raw ? Number(raw) : 5;
  if (!Number.isFinite(n)) return 5;
  return Math.min(Math.max(Math.trunc(n), 1), 50);
}

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'audit:read')) return forbidden();

  const url = new URL(req.url);
  const { since, days } = parseSince(url.searchParams.get('since'));
  const topN = parseTop(url.searchParams.get('top'));

  const [summary, daily, top, byMode] = await Promise.all([
    toolCallSummary(session.workspaceId, since),
    toolCallDailyCost(session.workspaceId, since),
    toolCallTopByCost(session.workspaceId, since, topN),
    toolCallByAclMode(session.workspaceId, since),
  ]);

  return NextResponse.json(
    {
      ok: true,
      window: { sinceDays: days, sinceIso: since.toISOString() },
      summary: {
        calls: summary.total,
        failed: summary.failed,
        awaiting: summary.awaiting,
        costUsd: summary.cost,
      },
      dailyCost: daily,
      topByCost: top,
      byAclMode: byMode,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
