/**
 * Internal hub DLQ admin.
 *
 * GET — list pending DLQ rows (replayedAt is null) for a workspace, oldest first.
 * POST — replay (re-broadcast) one or more DLQ rows by id; on success set
 *        `replayed_at`, on failure bump `attempts` and `last_attempt_at`.
 *
 * Auth: shared `HUB_INTERNAL_SECRET` header `x-hub-secret`. Same pattern as
 * the rest of `/api/internal/hub/*`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { hubDlqEnvelope } from '@metu/db/schema';
import { safeEqual } from '@/lib/safe-equal';
import { hubBroadcast, type DeviceKindFilter } from '@/lib/hub';
import type { ServerEvent } from '@/lib/hub';

export const runtime = 'nodejs';

function authed(req: Request): boolean {
  const secret = process.env.HUB_INTERNAL_SECRET;
  if (!secret) return false;
  return safeEqual(req.headers.get('x-hub-secret'), secret);
}

const listSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }
  const db = getDb();
  const conds = [isNull(hubDlqEnvelope.replayedAt)];
  if (parsed.data.workspaceId) conds.push(eq(hubDlqEnvelope.workspaceId, parsed.data.workspaceId));
  const rows = await db
    .select()
    .from(hubDlqEnvelope)
    .where(and(...conds))
    .orderBy(asc(hubDlqEnvelope.createdAt))
    .limit(parsed.data.limit);
  return NextResponse.json({ ok: true, rows });
}

const replaySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export async function POST(req: Request) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const json = await req.json().catch(() => null);
  const parsed = replaySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(hubDlqEnvelope)
    .where(and(inArray(hubDlqEnvelope.id, parsed.data.ids), isNull(hubDlqEnvelope.replayedAt)));

  let replayed = 0;
  let failed = 0;
  for (const row of rows) {
    const res = await hubBroadcast({
      workspaceId: row.workspaceId,
      envelope: row.envelope as ServerEvent,
      kinds: (row.kinds as DeviceKindFilter[]) ?? undefined,
      deviceIds: (row.deviceIds as string[]) ?? undefined,
    });
    if (res && res.delivered >= 0) {
      await db
        .update(hubDlqEnvelope)
        .set({ replayedAt: sql`now()`, lastAttemptAt: sql`now()` })
        .where(eq(hubDlqEnvelope.id, row.id));
      replayed++;
    } else {
      await db
        .update(hubDlqEnvelope)
        .set({ attempts: sql`${hubDlqEnvelope.attempts} + 1`, lastAttemptAt: sql`now()` })
        .where(eq(hubDlqEnvelope.id, row.id));
      failed++;
    }
  }

  return NextResponse.json({ ok: true, replayed, failed });
}
