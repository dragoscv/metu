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
import { agentPolicy, notification, notificationSubscription } from '@metu/db/schema';
import webpush from 'web-push';
import { Expo } from 'expo-server-sdk';
import { hubBroadcast } from './hub';
import { isQuietHoursActive } from './quiet-hours';
import { log } from './logger';

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

type Channel = 'ws' | 'web_push' | 'expo';

interface ResolvedPrefs {
  mutedChannels: Channel[];
  quietActive: boolean;
}

function isQuietActive(qh: Record<string, unknown> | null | undefined): boolean {
  return isQuietHoursActive(qh);
}

async function resolvePrefs(workspaceId: string): Promise<ResolvedPrefs> {
  const db = getDb();
  const [row] = await db
    .select({ quietHours: agentPolicy.quietHours, metadata: agentPolicy.metadata })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, workspaceId))
    .limit(1);
  if (!row) return { mutedChannels: [], quietActive: false };
  const meta = (row.metadata ?? {}) as { mutedChannels?: Channel[] };
  return {
    mutedChannels: Array.isArray(meta.mutedChannels) ? meta.mutedChannels : [],
    quietActive: isQuietActive(row.quietHours as Record<string, unknown> | null),
  };
}

export async function notify(input: NotifyInput): Promise<{ id: string; delivered: string[] }> {
  const db = getDb();
  const prefs = await resolvePrefs(input.workspaceId);
  const urgency = input.urgency ?? 'normal';
  // Quiet hours suppress non-urgent push channels but never the in-app
  // record; user still sees it next time they open the inbox.
  const quietBlocksPush = prefs.quietActive && urgency !== 'critical' && urgency !== 'high';

  const [row] = await db
    .insert(notification)
    .values({
      workspaceId: input.workspaceId,
      userId: input.userId,
      title: input.title,
      body: input.body ?? null,
      urgency,
      source: input.source ?? 'conductor',
      actionUrl: input.actionUrl ?? null,
      actions: input.actions ?? [],
      metadata: input.metadata ?? {},
    })
    .returning();

  const notificationId = row!.id;
  const delivered: string[] = [];

  // 1) Live fan-out via WS hub.
  const wsMuted = prefs.mutedChannels.includes('ws');
  const hubResult = wsMuted
    ? null
    : await hubBroadcast({
        workspaceId: input.workspaceId,
        envelope: {
          type: 'event.notification',
          id: notificationId,
          title: input.title,
          body: input.body,
          urgency,
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

  const webMuted = prefs.mutedChannels.includes('web_push') || quietBlocksPush;
  const expoMuted = prefs.mutedChannels.includes('expo') || quietBlocksPush;

  // Web push.
  if (!webMuted && webSubs.length > 0 && ensureWebPushConfigured()) {
    const payload = JSON.stringify({
      id: notificationId,
      title: input.title,
      body: input.body ?? '',
      url: input.actionUrl ?? '/',
      urgency,
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
  if (!expoMuted && expoSubs.length > 0) {
    // Track which subscription owns each message so dead-token tickets can be
    // mapped back to the row we need to disable. Expo guarantees tickets are
    // returned in the same order as the messages array we pass in.
    type ExpoMsg = {
      to: string;
      sound: 'default';
      title: string;
      body: string;
      data: { id: string; url: string };
      priority: 'high' | 'default';
    };
    const items: Array<{ subId: string; msg: ExpoMsg }> = [];
    for (const s of expoSubs) {
      const tok = (s.payload as { token: string }).token;
      if (!Expo.isExpoPushToken(tok)) {
        // Token shape is wrong → never going to deliver. Disable it
        // proactively so we don't keep ferrying it through every send.
        await db
          .update(notificationSubscription)
          .set({ enabled: false })
          .where(eq(notificationSubscription.id, s.id));
        log.warn('notify.expo.token_invalid', { subId: s.id });
        continue;
      }
      items.push({
        subId: s.id,
        msg: {
          to: tok,
          sound: 'default',
          title: input.title,
          body: input.body ?? '',
          data: { id: notificationId, url: input.actionUrl ?? '/' },
          priority: input.urgency === 'critical' ? 'high' : 'default',
        },
      });
    }
    if (items.length > 0) {
      // chunkPushNotifications splits into ≤100-message batches but the
      // mapping by index still holds within each chunk if we slice items
      // in lock-step.
      const messages = items.map((i) => i.msg);
      const chunks = expo.chunkPushNotifications(messages);
      let okCount = 0;
      let cursor = 0;
      for (const chunk of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const item = items[cursor + i];
            if (!ticket || !item) continue;
            if (ticket.status === 'ok') {
              okCount++;
              continue;
            }
            // Error ticket — Expo encodes the actionable reason on
            // details.error. DeviceNotRegistered is permanent; the rest
            // (MessageTooBig, MessageRateExceeded, MismatchSenderId,
            // InvalidCredentials) are operator-side and shouldn't disable
            // the subscription.
            const reason = (ticket.details as { error?: string } | undefined)?.error ?? 'unknown';
            log.warn('notify.expo.ticket_error', {
              subId: item.subId,
              error: reason,
              message: ticket.message,
            });
            if (reason === 'DeviceNotRegistered') {
              await db
                .update(notificationSubscription)
                .set({ enabled: false })
                .where(eq(notificationSubscription.id, item.subId));
            }
          }
        } catch (err) {
          log.error('notify.expo.push_failed', { chunkSize: chunk.length }, err);
        }
        cursor += chunk.length;
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

/**
 * Push-only delivery for callers that already inserted a `notification`
 * row themselves (e.g. morning brief). Sends web push + Expo push to the
 * user's registered subscriptions; honours quiet hours + per-channel
 * mutes the same way as `notify()`. Does NOT insert a row, does NOT
 * broadcast on the hub.
 */
export async function sendPushOnly(input: {
  workspaceId: string;
  userId: string;
  title: string;
  body?: string;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  actionUrl?: string;
  notificationId?: string;
}): Promise<{ delivered: string[] }> {
  const db = getDb();
  const prefs = await resolvePrefs(input.workspaceId);
  const urgency = input.urgency ?? 'normal';
  const quietBlocksPush = prefs.quietActive && urgency !== 'critical' && urgency !== 'high';
  const delivered: string[] = [];

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

  const webMuted = prefs.mutedChannels.includes('web_push') || quietBlocksPush;
  const expoMuted = prefs.mutedChannels.includes('expo') || quietBlocksPush;

  if (!webMuted && webSubs.length > 0 && ensureWebPushConfigured()) {
    const payload = JSON.stringify({
      id: input.notificationId ?? '',
      title: input.title,
      body: input.body ?? '',
      url: input.actionUrl ?? '/',
      urgency,
    });
    const results = await Promise.allSettled(
      webSubs.map((s) => {
        const sub = s.payload as {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        };
        return webpush.sendNotification(sub, payload).catch(async (err) => {
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

  if (!expoMuted && expoSubs.length > 0) {
    const items: Array<{
      subId: string;
      msg: {
        to: string;
        sound: 'default';
        title: string;
        body: string;
        data: { id: string; url: string };
        priority: 'high' | 'default';
      };
    }> = [];
    for (const s of expoSubs) {
      const tok = (s.payload as { token: string }).token;
      if (!Expo.isExpoPushToken(tok)) {
        await db
          .update(notificationSubscription)
          .set({ enabled: false })
          .where(eq(notificationSubscription.id, s.id));
        continue;
      }
      items.push({
        subId: s.id,
        msg: {
          to: tok,
          sound: 'default',
          title: input.title,
          body: input.body ?? '',
          data: { id: input.notificationId ?? '', url: input.actionUrl ?? '/' },
          priority: urgency === 'critical' ? 'high' : 'default',
        },
      });
    }
    if (items.length > 0) {
      const messages = items.map((i) => i.msg);
      const chunks = expo.chunkPushNotifications(messages);
      let okCount = 0;
      let cursor = 0;
      for (const chunk of chunks) {
        try {
          const tickets = await expo.sendPushNotificationsAsync(chunk);
          for (let i = 0; i < tickets.length; i++) {
            const ticket = tickets[i];
            const item = items[cursor + i];
            if (!ticket || !item) continue;
            if (ticket.status === 'ok') {
              okCount++;
              continue;
            }
            const reason = (ticket.details as { error?: string } | undefined)?.error ?? 'unknown';
            if (reason === 'DeviceNotRegistered') {
              await db
                .update(notificationSubscription)
                .set({ enabled: false })
                .where(eq(notificationSubscription.id, item.subId));
            }
          }
        } catch (err) {
          log.error('notify.push_only.expo_failed', { chunkSize: chunk.length }, err);
        }
        cursor += chunk.length;
      }
      if (okCount > 0) delivered.push(`expo:${okCount}`);
    }
  }

  return { delivered };
}
