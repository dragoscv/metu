/**
 * Per-user notification queries — currently just the unread count
 * for the sidebar badge. Centralized here so other surfaces can
 * reuse without copy-pasting `eq(notification.acknowledgedAt, null)`.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { notification } from '../schema';

export async function notificationUnreadCount(
  workspaceId: string,
  userId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, workspaceId),
        eq(notification.userId, userId),
        isNull(notification.acknowledgedAt),
      ),
    );
  return row?.n ?? 0;
}
