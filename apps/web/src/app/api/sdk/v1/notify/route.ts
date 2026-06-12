/**
 * SDK v1 — POST /api/sdk/v1/notify
 * Bearer auth (`notify:write` scope). Routes through the notification fabric
 * (`notify()`): writes the row, broadcasts via hub, and fans out to web push +
 * Expo subscriptions. Also emits `conductor/observe` so the supervisor sees
 * external notifications.
 */
import { NextResponse } from 'next/server';
import { NotifyCreateSchema } from '@metu/protocol';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { notify } from '@/lib/notify';
import { inngest } from '@/inngest/client';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = NotifyCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const result = await notify({
    workspaceId: session.workspaceId,
    userId: session.userId,
    title: parsed.data.title,
    body: parsed.data.body ?? undefined,
    urgency: parsed.data.urgency,
    source: parsed.data.source ?? 'app',
    actionUrl: parsed.data.actionUrl ?? undefined,
    metadata: session.clientId ? { oauthClientId: session.clientId } : {},
  });

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'notification.created',
      payload: {
        notificationId: result.id,
        source: parsed.data.source ?? 'app',
        urgency: parsed.data.urgency,
      },
    },
  });

  return NextResponse.json({ ok: true, id: result.id, delivered: result.delivered });
}
