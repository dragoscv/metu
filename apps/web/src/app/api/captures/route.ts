import { NextResponse } from 'next/server';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { createCaptureSchema } from '@metu/types';
import { inngest } from '@/inngest/client';
import { resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();

  const json = await req.json().catch(() => null);
  const parsed = createCaptureSchema.safeParse(json);
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
      source: parsed.data.source ?? 'api',
      metadata: parsed.data.metadata ?? {},
    })
    .returning();

  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    projectId: parsed.data.projectId ?? null,
    kind: 'capture.created',
    title: (parsed.data.content ?? '').slice(0, 80) || `${parsed.data.kind} capture`,
    importance: 0.3,
  });

  await inngest.send({
    name: 'capture/created',
    data: { workspaceId: session.workspaceId, captureId: row!.id, userId: session.userId },
  });

  return NextResponse.json({ ok: true, id: row!.id });
}
