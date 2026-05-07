'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Inngest } from 'inngest';

const inngest = new Inngest({ id: 'metu' });

async function ensureCaptureOwnership(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const [row] = await db
    .select()
    .from(capture)
    .where(and(eq(capture.id, id), eq(capture.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Not found' };
  return { ok: true as const, session, row, db };
}

export async function updateCaptureAction(input: {
  id: string;
  content?: string | null;
  projectId?: string | null;
}) {
  const access = await ensureCaptureOwnership(input.id);
  if (!access.ok) return access;
  const { db, session } = access;
  const patch: Record<string, unknown> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db.update(capture).set(patch).where(eq(capture.id, input.id));
  if ('projectId' in patch) {
    await db.insert(timelineEvent).values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      projectId: input.projectId ?? null,
      kind: 'capture.assigned',
      title: 'Capture assigned to project',
      payload: { captureId: input.id, projectId: input.projectId },
      importance: 0.3,
    });
  }
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${input.id}`);
  return { ok: true as const, id: input.id };
}

export async function deleteCaptureAction(id: string) {
  const access = await ensureCaptureOwnership(id);
  if (!access.ok) return access;
  const { db } = access;
  await db.update(capture).set({ deletedAt: new Date() }).where(eq(capture.id, id));
  revalidatePath('/inbox');
  return { ok: true as const };
}

export async function retryCaptureAction(id: string) {
  const access = await ensureCaptureOwnership(id);
  if (!access.ok) return access;
  const { db, session, row } = access;
  if (row.status !== 'failed') {
    return { ok: false as const, error: `Cannot retry ${row.status} capture` };
  }
  await db
    .update(capture)
    .set({ status: 'processing' })
    .where(and(eq(capture.id, id), isNull(capture.deletedAt)));
  try {
    await inngest.send({
      name: 'capture/created',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        captureId: id,
      },
    });
  } catch (err) {
    console.warn('inngest dispatch failed', err);
  }
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
  return { ok: true as const };
}
