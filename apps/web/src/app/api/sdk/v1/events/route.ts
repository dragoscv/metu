/**
 * SDK v1 — POST /api/sdk/v1/events
 *
 * Generic app event sink. Records a timeline event and emits
 * `conductor/observe` so the supervisor can react.
 *
 * Bearer auth (`event:write` scope).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

const schema = z.object({
  kind: z.string().min(1).max(120),
  title: z.string().max(200).optional(),
  body: z.string().max(4000).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  importance: z.number().min(0).max(1).optional(),
  projectId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'event:write')) return forbidden();

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
  const [row] = await db
    .insert(timelineEvent)
    .values({
      workspaceId: session.workspaceId,
      projectId: parsed.data.projectId ?? null,
      kind: `app.${parsed.data.kind}`,
      title: parsed.data.title ?? parsed.data.kind,
      body: parsed.data.body ?? null,
      payload: {
        ...parsed.data.payload,
        ...(session.clientId ? { oauthClientId: session.clientId } : {}),
      },
      importance: parsed.data.importance ?? 0.3,
    })
    .returning();

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: `app.${parsed.data.kind}`,
      payload: { timelineEventId: row!.id },
    },
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
