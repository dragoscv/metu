/**
 * Notification fabric.
 *
 * The single entry point is `notify(input)`:
 *   1. Insert a row in `notification`.
 *   2. Broadcast `event.notification` to all online devices via the hub
 *      (instant in-app toast / slider on connected web/mobile/desktop).
 *   3. Send web push (VAPID) and Expo push to subscriptions registered for
 *      this user — covers offline / background-tab cases.
 *   4. Update `notification.deliveredTo` with the channels that succeeded.
 *
 * Failure mode: any single channel failing is logged and skipped — the
 * notification is still recorded in the DB and surfaced when the user opens
 * the inbox.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notification, notificationSubscription } from '@metu/db/schema';
import webpush from 'web-push';
import { Expo } from 'expo-server-sdk';
import { hubBroadcast } from './hub';

export interface NotifyAction {
  id: string;
  label: string;
  kind: 'approve' | 'reject' | 'open' | 'custom';
}

export interface NotifyInput {
  workspaceId: string;
  userId: string;
  title: string;
  body?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  source?: string;
  actionUrl?: string;
  actions?: NotifyAction[];
  metadata?: Record<string, unknown>;
}

let webPushReady = false;
function ensureWebPushConfigured(): boolean {
  if (webPushReady) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@metu.app';
  if (!pub || !priv) return false;
  webpush.setVapidDetails(subject, pub, priv);
  webPushReady = true;
  return true;
}

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

export async function notify(input: NotifyInput): Promise<{ id: string; delivered: string[] }> {
  const db = getDb();
  const [row] = await db
    .insert(notification)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      urgency: input.urgency ?? 'normal',
      source: input.source ?? 'conductor',
      actionUrl: input.actionUrl ?? null,
      actions: input.actions ?? [],
      metadata: input.metadata ?? {},
    })
    .returning();

  const notificationId = row!.id;
  const delivered: string[] = [];

  // 1) Live fan-out via WS hub.
  const hubResult = await hubBroadcast({
    workspaceId: input.workspaceId,
    envelope: {
      type: 'event.notification',
      id: notificationId,
      title: input.title,
      body: input.body,
      urgency: input.urgency ?? 'normal',
      actionUrl: input.actionUrl,
      actions: input.actions ?? [],
    },
  });
  if (hubResult && hubResult.delivered > 0) delivered.push(`ws:${hubResult.delivered}`);

  // 2) Push subscriptions (web push + expo).
  const subs = await db
    .select()
    .from(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.userId, input.userId),
        eq(notificationSubscription.enabled, true),
      ),
    );

  const webSubs = subs.filter((s) => s.channel === 'web_push');
  const expoSubs = subs.filter((s) => s.channel === 'expo');

  // Web push.
  if (webSubs.length > 0 && ensureWebPushConfigured()) {
    const payload = JSON.stringify({
      id: notificationId,
      title: input.title,
      body: input.body ?? '',
      url: input.actionUrl ?? '/',
      urgency: input.urgency ?? 'normal',
    });
    const results = await Promise.allSettled(
      webSubs.map((s) => {
        const sub = s.payload as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        return webpush.sendNotification(sub, payload).catch(async (err) => {
          // 410 / 404 → subscription dead, disable it.
          if (err && (err.statusCode === 410 || err.statusCode === 404)) {
            await db
              .update(notificationSubscription)
              .set({ enabled: false })
              .where(eq(notificationSubscription.id, s.id));
          }
          throw err;
        });
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (ok > 0) delivered.push(`web_push:${ok}`);
  }

  // Expo push.
  if (expoSubs.length > 0) {
    const messages = expoSubs
      .map((s) => {
        const tok = (s.payload as { token: string }).token;
        if (!Expo.isExpoPushToken(tok)) return null;
        return {
          to: tok,
          sound: 'default' as const,
          title: input.title,
          body: input.body ?? '',
          data: { id: notificationId, url: input.actionUrl ?? '/' },
          priority: input.urgency === 'critical' ? ('high' as const) : ('default' as const),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (messages.length > 0) {
      const chunks = expo.chunkPushNotifications(messages);
      let okCount = 0;
      for (const chunk of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          okCount += tickets.filter((t) => t.status === 'ok').length;
        } catch (err) {
          console.error('[notify] expo push error', err);
        }
      }
      if (okCount > 0) delivered.push(`expo:${okCount}`);
    }
  }

  if (delivered.length > 0) {
    await db
      .update(notification)
      .set({ deliveredTo: delivered })
      .where(eq(notification.id, notificationId));
  }

  return { id: notificationId, delivered };
}
