/**
 * Server actions for managing per-device push subscriptions.
 *
 * Web push: browser calls `pushManager.subscribe()` then posts the
 * `PushSubscription.toJSON()` blob here.
 * Expo: mobile app posts the Expo push token.
 */
'use server';
import { z } from 'zod';
import { eq, and, isNull, desc, like } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { getDb } from '@metu/db';
import { notification, notificationSubscription } from '@metu/db/schema';
import { auth } from '@metu/auth';
import { notify } from '@/lib/notify';

const webPushSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

const expoSchema = z.object({
  token: z.string().min(10),
});

export async function registerWebPushAction(input: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceId?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const parsed = webPushSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_subscription' };

  const db = getDb();
  // Replace any existing row with the same endpoint for this user.
  const existing = await db
    .select()
    .from(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.userId, session.user.id),
        eq(notificationSubscription.channel, 'web_push'),
      ),
    );
  for (const row of existing) {
    if ((row.payload as { endpoint?: string }).endpoint === parsed.data.endpoint) {
      await db
        .update(notificationSubscription)
        .set({ payload: parsed.data, enabled: true, deviceId: input.deviceId ?? row.deviceId })
        .where(eq(notificationSubscription.id, row.id));
      return { ok: true, id: row.id };
    }
  }

  const [created] = await db
    .insert(notificationSubscription)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      deviceId: input.deviceId ?? null,
      channel: 'web_push',
      payload: parsed.data,
    })
    .returning();
  return { ok: true, id: created!.id };
}

export async function registerExpoTokenAction(input: {
  token: string;
  deviceId?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const parsed = expoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_token' };

  const db = getDb();
  const existing = await db
    .select()
    .from(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.userId, session.user.id),
        eq(notificationSubscription.channel, 'expo'),
      ),
    );
  for (const row of existing) {
    if ((row.payload as { token?: string }).token === parsed.data.token) {
      await db
        .update(notificationSubscription)
        .set({ enabled: true, deviceId: input.deviceId ?? row.deviceId })
        .where(eq(notificationSubscription.id, row.id));
      return { ok: true, id: row.id };
    }
  }

  const [created] = await db
    .insert(notificationSubscription)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      deviceId: input.deviceId ?? null,
      channel: 'expo',
      payload: parsed.data,
    })
    .returning();
  return { ok: true, id: created!.id };
}

export async function unsubscribePushAction(id: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const db = getDb();
  await db
    .update(notificationSubscription)
    .set({ enabled: false })
    .where(
      and(
        eq(notificationSubscription.id, id),
        eq(notificationSubscription.userId, session.user.id),
      ),
    );
  return { ok: true };
}

/**
 * Latest unacknowledged notifications for the current user. Used by the bell popover.
 */
export async function listRecentNotificationsAction(limit = 20) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false as const, error: 'unauthorized' };
  const db = getDb();
  const rows = await db
    .select({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      urgency: notification.urgency,
      source: notification.source,
      actionUrl: notification.actionUrl,
      actions: notification.actions,
      metadata: notification.metadata,
      readAt: notification.readAt,
      acknowledgedAt: notification.acknowledgedAt,
      createdAt: notification.createdAt,
    })
    .from(notification)
    .where(and(eq(notification.userId, session.user.id), isNull(notification.acknowledgedAt)))
    .orderBy(desc(notification.createdAt))
    .limit(limit);
  return {
    ok: true as const,
    items: rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    })),
  };
}

export async function ackNotificationAction(id: string): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const db = getDb();
  await db
    .update(notification)
    .set({ acknowledgedAt: new Date(), readAt: new Date() })
    .where(and(eq(notification.id, id), eq(notification.userId, session.user.id)));
  revalidatePath('/');
  return { ok: true };
}

const ackAllFilterSchema = z
  .object({
    urgency: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    source: z.enum(['conductor', 'integration', 'app']).optional(),
  })
  .optional();

export async function ackAllNotificationsAction(
  input?: z.input<typeof ackAllFilterSchema>,
): Promise<{ ok: boolean }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false };
  const parsed = ackAllFilterSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const filter = parsed.data;
  const db = getDb();
  const now = new Date();
  await db
    .update(notification)
    .set({ acknowledgedAt: now, readAt: now })
    .where(
      and(
        eq(notification.userId, session.user.id),
        eq(notification.workspaceId, session.user.workspaceId),
        isNull(notification.acknowledgedAt),
        filter?.urgency ? eq(notification.urgency, filter.urgency) : undefined,
        filter?.source === 'conductor'
          ? eq(notification.source, 'conductor')
          : filter?.source === 'integration'
            ? like(notification.source, 'integration:%')
            : filter?.source === 'app'
              ? like(notification.source, 'app:%')
              : undefined,
      ),
    );
  revalidatePath('/');
  return { ok: true };
}

/**
 * Send a self-test notification through the full fabric (DB row + WS hub
 * fan-out + web push + Expo push). Used by the settings "Send test
 * notification" button to verify end-to-end delivery to phone/desktop.
 *
 * Counts how many push subscriptions the user has so the UI can warn when
 * there are zero (i.e. the test will only land in the in-app inbox).
 */
export async function sendTestNotificationAction(): Promise<
  | { ok: true; id: string; delivered: string[]; subscriptions: number }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };
  const db = getDb();
  const subs = await db
    .select({ id: notificationSubscription.id })
    .from(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.userId, session.user.id),
        eq(notificationSubscription.enabled, true),
      ),
    );
  const result = await notify({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    title: 'metu test notification',
    body: 'If you can see this, the fabric is wired end-to-end.',
    urgency: 'normal',
    source: 'settings:test',
    actionUrl: '/notifications',
  });
  return {
    ok: true,
    id: result.id,
    delivered: result.delivered,
    subscriptions: subs.length,
  };
}
