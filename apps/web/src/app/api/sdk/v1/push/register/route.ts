/**
 * SDK v1 — POST /api/sdk/v1/push/register
 *
 * Bearer auth (`notify:read` scope — receiving push). Lets a mobile/desktop
 * client register an Expo or web-push subscription tied to its OAuth identity.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { notificationSubscription } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

const schema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('web_push'),
    deviceId: z.string().uuid().optional(),
    payload: z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
  }),
  z.object({
    channel: z.literal('expo'),
    deviceId: z.string().uuid().optional(),
    payload: z.object({ token: z.string().min(10) }),
  }),
]);

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:read')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const existing = await db
    .select()
    .from(notificationSubscription)
    .where(
      and(
        eq(notificationSubscription.userId, session.userId),
        eq(notificationSubscription.channel, parsed.data.channel),
      ),
    );
  for (const row of existing) {
    const samePayload =
      parsed.data.channel === 'web_push'
        ? (row.payload as { endpoint?: string }).endpoint === parsed.data.payload.endpoint
        : (row.payload as { token?: string }).token === parsed.data.payload.token;
    if (samePayload) {
      await db
        .update(notificationSubscription)
        .set({
          enabled: true,
          deviceId: parsed.data.deviceId ?? row.deviceId,
        })
        .where(eq(notificationSubscription.id, row.id));
      return NextResponse.json({ ok: true, id: row.id });
    }
  }

  const [created] = await db
    .insert(notificationSubscription)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      deviceId: parsed.data.deviceId ?? null,
      channel: parsed.data.channel,
      payload: parsed.data.payload,
    })
    .returning();
  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'push.registered',
      payload: { subscriptionId: created!.id, channel: parsed.data.channel },
    },
  });
  return NextResponse.json({ ok: true, id: created!.id });
}
