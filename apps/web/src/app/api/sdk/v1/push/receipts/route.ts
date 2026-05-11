/**
 * SDK v1 — GET /api/sdk/v1/push/receipts
 *
 * Bearer auth (`audit:read` scope). Returns counts of push receipts in
 * the last `since` window, grouped by status. Useful for a mobile-side
 * "delivery health" widget.
 *
 * Query params:
 *   - since: `Nd` (default 7d, capped 1..90).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { pushReceipt } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const schema = z.object({
  since: z
    .string()
    .regex(/^\d+d$/)
    .optional(),
});

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'audit:read')) return forbidden();

  const limited = await rateLimit('sdk-read', session.userId);
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const days = Math.min(Math.max(Number(parsed.data.since?.replace('d', '') ?? 7), 1), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const db = getDb();
  const rows = await db
    .select({ status: pushReceipt.status, n: count() })
    .from(pushReceipt)
    .where(and(eq(pushReceipt.workspaceId, session.workspaceId), gt(pushReceipt.createdAt, since)))
    .groupBy(pushReceipt.status);

  const out = { ok: 0, error: 0, pending: 0 } as Record<string, number>;
  for (const r of rows) out[r.status] = Number(r.n);

  // Top error codes
  const errors = await db
    .select({ code: pushReceipt.errorCode, n: count() })
    .from(pushReceipt)
    .where(
      and(
        eq(pushReceipt.workspaceId, session.workspaceId),
        gt(pushReceipt.createdAt, since),
        eq(pushReceipt.status, 'error'),
      ),
    )
    .groupBy(pushReceipt.errorCode)
    .orderBy(sql`count(*) desc`)
    .limit(10);

  return NextResponse.json({
    ok: true,
    sinceDays: days,
    counts: out,
    topErrors: errors.map((e) => ({ code: e.code ?? 'unknown', count: Number(e.n) })),
  });
}
