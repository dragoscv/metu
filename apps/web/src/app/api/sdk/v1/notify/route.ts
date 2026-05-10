/**
 * SDK v1 — POST /api/sdk/v1/notify
 * Bearer auth (`notify:write` scope). Records a notification row; the
 * notification fabric (slice 5) fans it out to subscribed devices.
 */
import { NextResponse } from 'next/server';
import { NotifyCreateSchema } from '@metu/protocol';
import { getDb } from '@metu/db';
import { notification } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

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

  const db = getDb();
  const [row] = await db
    .insert(notification)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      urgency: parsed.data.urgency,
      source: parsed.data.source ?? 'app',
      actionUrl: parsed.data.actionUrl ?? null,
      metadata: session.clientId ? { oauthClientId: session.clientId } : {},
    })
    .returning();

  return NextResponse.json({ ok: true, id: row!.id });
}
