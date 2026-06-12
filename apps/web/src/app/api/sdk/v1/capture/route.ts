/**
 * SDK v1 — POST /api/sdk/v1/capture
 *
 * Bearer auth (`capture:write` scope). Inserts a capture, fires a timeline
 * event, and emits `conductor/observe` so the supervisor sees it.
 */
import { NextResponse } from 'next/server';
import { CaptureCreateSchema } from '@metu/protocol';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'capture:write')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = CaptureCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [row] = await db
    .insert(capture)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      projectId: parsed.data.projectId ?? null,
      kind: parsed.data.kind,
      status: parsed.data.kind === 'voice' ? 'received' : 'ready',
      content: parsed.data.content ?? null,
      storageKey: parsed.data.storageKey ?? null,
      source: parsed.data.source ?? 'sdk',
      metadata: {
        ...parsed.data.metadata,
        ...(parsed.data.sourceUrl ? { sourceUrl: parsed.data.sourceUrl } : {}),
        ...(session.clientId ? { oauthClientId: session.clientId } : {}),
      },
    })
    .returning();

  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    projectId: parsed.data.projectId ?? null,
    kind: 'capture.created',
    title: (parsed.data.content ?? '').slice(0, 80) || `${parsed.data.kind} capture`,
    importance: 0.3,
    payload: { captureId: row!.id, source: parsed.data.source ?? 'sdk' },
  });

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'capture.created',
      payload: { captureId: row!.id, kind: parsed.data.kind },
    },
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
