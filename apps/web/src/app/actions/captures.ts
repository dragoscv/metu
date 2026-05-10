'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { Inngest } from 'inngest';
import { log } from '@/lib/logger';

const inngest = new Inngest({ id: 'metu' });

const UpdateCaptureSchema = z.object({
  id: z.string().uuid(),
  content: z.string().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
});
const CaptureIdSchema = z.string().uuid();

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
  const parsed = UpdateCaptureSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  input = parsed.data;
  const access = await ensureCaptureOwnership(input.id);
  if (!access.ok) return access;
  const { db, session } = access;
  const patch: Record<string, unknown> = {};
  if (input.content !== undefined) patch.content = input.content;
  if (input.projectId !== undefined) patch.projectId = input.projectId;
  if (Object.keys(patch).length === 0) return { ok: true as const, id: input.id };
  await db
    .update(capture)
    .set(patch)
    .where(and(eq(capture.id, input.id), eq(capture.workspaceId, session.user.workspaceId)));
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
  const parsed = CaptureIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  id = parsed.data;
  const access = await ensureCaptureOwnership(id);
  if (!access.ok) return access;
  const { db, session } = access;
  await db
    .update(capture)
    .set({ deletedAt: new Date() })
    .where(and(eq(capture.id, id), eq(capture.workspaceId, session.user.workspaceId)));
  revalidatePath('/inbox');
  return { ok: true as const };
}

export async function retryCaptureAction(id: string) {
  const parsed = CaptureIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false as const, error: 'invalid_input' };
  id = parsed.data;
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
    log.warn('captures.inngest.dispatch_failed', {}, err);
  }
  revalidatePath('/inbox');
  revalidatePath(`/inbox/${id}`);
  return { ok: true as const };
}
