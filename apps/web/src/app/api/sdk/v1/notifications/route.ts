/**
 * SDK v1 — GET /api/sdk/v1/notifications
 *
 * Bearer auth (`notify:read` scope). Returns the most-recent N
 * notifications for the current user, newest first. Used by the mobile
 * notification center; also safe for any client UI that wants to render
 * the user's notification stream.
 *
 * Optional query params:
 *   - `limit` (default 30, max 100)
 *   - `unreadOnly` ('1' / 'true' to filter out `readAt != null`)
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  unreadOnly: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export async function GET(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:read')) return forbidden();

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    unreadOnly: url.searchParams.get('unreadOnly') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const filters = [
    eq(notification.workspaceId, session.workspaceId),
    eq(notification.userId, session.userId),
  ];
  if (parsed.data.unreadOnly) {
    filters.push(isNull(notification.readAt));
  }

  const rows = await db
    .select({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      urgency: notification.urgency,
      source: notification.source,
      actionUrl: notification.actionUrl,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(and(...filters))
    .orderBy(desc(notification.createdAt))
    .limit(parsed.data.limit);

  return NextResponse.json({
    ok: true,
    notifications: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      urgency: r.urgency,
      source: r.source,
      actionUrl: r.actionUrl,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
