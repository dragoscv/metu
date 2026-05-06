'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import { createCaptureSchema, type CreateCaptureInput } from '@metu/types';
import { Inngest } from 'inngest';

const inngest = new Inngest({ id: 'metu' });

export async function createCapture(input: CreateCaptureInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };

  const parsed = createCaptureSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }

  const db = getDb();
  const [row] = await db
    .insert(capture)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      projectId: parsed.data.projectId ?? null,
      kind: parsed.data.kind,
      status: parsed.data.kind === 'text' ? 'ready' : 'processing',
      content: parsed.data.content ?? null,
      storageKey: parsed.data.storageKey ?? null,
      sourceUrl: parsed.data.sourceUrl ?? null,
      source: parsed.data.source,
      metadata: parsed.data.metadata,
    })
    .returning();

  if (!row) return { ok: false as const, error: 'Insert failed' };

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    projectId: parsed.data.projectId ?? null,
    kind: 'capture.created',
    title:
      parsed.data.kind === 'text'
        ? (parsed.data.content?.slice(0, 80) ?? 'Capture')
        : `${parsed.data.kind} capture`,
    payload: { captureId: row.id, kind: parsed.data.kind },
    importance: 0.4,
  });

  // Fire-and-forget background processing
  try {
    await inngest.send({
      name: 'capture/created',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        captureId: row.id,
      },
    });
  } catch (err) {
    console.warn('inngest dispatch failed', err);
  }

  revalidatePath('/dashboard');
  revalidatePath('/inbox');

  return { ok: true as const, id: row.id };
}
