/**
 * Server actions for managing per-device push subscriptions.
 *
 * Web push: browser calls `pushManager.subscribe()` then posts the
 * `PushSubscription.toJSON()` blob here.
 * Expo: mobile app posts the Expo push token.
 */
'use server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notificationSubscription } from '@metu/db/schema';
import { auth } from '@metu/auth';

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
