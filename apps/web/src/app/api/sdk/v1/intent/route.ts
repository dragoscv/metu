/**
 * SDK v1 — POST /api/sdk/v1/intent
 *
 * A satellite app (notai/bancai/facturai/…) tells METU "this entity needs
 * action". METU mirrors it as a `task` row tagged with sourceApp/Ref/Url so
 * the Conductor can include it in unified planning. Emits `conductor/observe`.
 *
 * Bearer auth (`intent:write` scope).
 */
import { NextResponse } from 'next/server';
import { IntentCreateSchema } from '@metu/protocol';
import { getDb } from '@metu/db';
import { task, timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'intent:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = IntentCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const sourceApp = parsed.data.sourceApp ?? session.clientId ?? 'unknown';
  const db = getDb();
  const [row] = await db
    .insert(task)
    .values({
      workspaceId: session.workspaceId,
      projectId: parsed.data.projectId ?? null,
      title: parsed.data.title,
      body: parsed.data.body ?? null,
      status: parsed.data.status,
      kind: 'shallow',
      aiSuggested: 1,
      sourceApp,
      sourceEntityRef: parsed.data.sourceEntityRef ?? {},
      sourceUrl: parsed.data.sourceUrl ?? null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    })
    .returning();

  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    projectId: parsed.data.projectId ?? null,
    kind: 'intent.received',
    title: parsed.data.title.slice(0, 80),
    body: parsed.data.body?.slice(0, 240) ?? null,
    importance: parsed.data.importance,
    payload: {
      taskId: row!.id,
      sourceApp,
      sourceEntityRef: parsed.data.sourceEntityRef ?? {},
      sourceUrl: parsed.data.sourceUrl ?? null,
    },
  });

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'intent.received',
      payload: {
        taskId: row!.id,
        sourceApp,
        title: parsed.data.title,
        importance: parsed.data.importance,
      },
    },
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
