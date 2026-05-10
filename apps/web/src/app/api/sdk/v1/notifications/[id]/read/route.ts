/**
 * SDK v1 — POST /api/sdk/v1/notifications/[id]/read
 *
 * Bearer auth (`notify:read` scope). Marks one notification as read for
 * the current user. Idempotent — if already read, returns ok without
 * touching `readAt`.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:read')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'invalid_id' }, { status: 400 });
  }

  const db = getDb();
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.id, id),
        eq(notification.workspaceId, session.workspaceId),
        eq(notification.userId, session.userId),
        isNull(notification.readAt),
      ),
    );

  return NextResponse.json({ ok: true });
}
