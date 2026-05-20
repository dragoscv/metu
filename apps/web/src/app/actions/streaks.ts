'use server';
/**
 * Streaks server actions. All workspace-scoped via session.
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { streak } from '@metu/db/schema';
import { upsertStreakEntry, deleteStreakEntry } from '@metu/db/queries';

const kind = z.enum(['abstain', 'do_daily', 'count', 'boolean']);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  body: z.string().max(2000).optional(),
  kind,
  target: z.number().positive().optional(),
  unit: z.string().max(40).optional(),
  color: z.string().max(40).optional(),
  weight: z.number().int().min(1).max(5).default(3),
  startedAt: z.string().datetime().optional(),
});

export async function createStreakAction(input: z.infer<typeof createSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = createSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const [row] = await db
    .insert(streak)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      name: parsed.data.name,
      body: parsed.data.body ?? null,
      kind: parsed.data.kind,
      target: parsed.data.target ?? null,
      unit: parsed.data.unit ?? null,
      color: parsed.data.color ?? null,
      weight: parsed.data.weight,
      startedAt: parsed.data.startedAt ? new Date(parsed.data.startedAt) : new Date(),
    })
    .returning();
  revalidatePath('/streaks');
  return { ok: true as const, id: row!.id };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120).optional(),
  body: z.string().max(2000).nullable().optional(),
  target: z.number().positive().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  weight: z.number().int().min(1).max(5).optional(),
});

export async function updateStreakAction(input: z.infer<typeof updateSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'body', 'target', 'unit', 'color', 'weight'] as const) {
    const v = parsed.data[k];
    if (v !== undefined) patch[k] = v;
  }
  await db
    .update(streak)
    .set(patch)
    .where(and(eq(streak.id, parsed.data.id), eq(streak.workspaceId, session.user.workspaceId)));
  revalidatePath('/streaks');
  return { ok: true as const };
}

export async function archiveStreakAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(streak)
    .set({ archivedAt: new Date() })
    .where(and(eq(streak.id, id), eq(streak.workspaceId, session.user.workspaceId)));
  revalidatePath('/streaks');
  return { ok: true as const };
}

export async function unarchiveStreakAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .update(streak)
    .set({ archivedAt: null })
    .where(and(eq(streak.id, id), eq(streak.workspaceId, session.user.workspaceId)));
  revalidatePath('/streaks');
  return { ok: true as const };
}

export async function deleteStreakAction(id: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(streak)
    .where(and(eq(streak.id, id), eq(streak.workspaceId, session.user.workspaceId)));
  revalidatePath('/streaks');
  return { ok: true as const };
}

const logEntrySchema = z.object({
  streakId: z.string().uuid(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().optional(),
  failed: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

export async function logStreakEntryAction(input: z.infer<typeof logEntrySchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = logEntrySchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  // confirm the streak belongs to this workspace
  const db = getDb();
  const owned = await db
    .select({ id: streak.id })
    .from(streak)
    .where(
      and(eq(streak.id, parsed.data.streakId), eq(streak.workspaceId, session.user.workspaceId)),
    )
    .limit(1);
  if (owned.length === 0) return { ok: false as const, error: 'Not found' };
  await upsertStreakEntry({
    workspaceId: session.user.workspaceId,
    streakId: parsed.data.streakId,
    day: parsed.data.day,
    value: parsed.data.value,
    failed: parsed.data.failed,
    note: parsed.data.note ?? null,
  });
  revalidatePath('/streaks');
  return { ok: true as const };
}

export async function deleteStreakEntryAction(streakId: string, day: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false as const, error: 'Invalid day' };
  const db = getDb();
  const owned = await db
    .select({ id: streak.id })
    .from(streak)
    .where(and(eq(streak.id, streakId), eq(streak.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (owned.length === 0) return { ok: false as const, error: 'Not found' };
  await deleteStreakEntry(session.user.workspaceId, streakId, day);
  revalidatePath('/streaks');
  return { ok: true as const };
}
