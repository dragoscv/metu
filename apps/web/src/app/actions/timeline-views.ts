'use server';

/**
 * Saved timeline views — named filter bookmarks per user, synced via DB
 * so they follow the user across devices. The URL remains the live
 * source of truth; these are just shortcuts.
 */
import { auth } from '@metu/auth';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { timelineSavedView } from '@metu/db/schema';
import { revalidatePath } from 'next/cache';

const MAX_VIEWS = 20;

const saveSchema = z.object({
  name: z.string().min(1).max(60),
  // Restrict to the known /timeline params; prevents arbitrary URL spray.
  params: z
    .string()
    .max(2000)
    .refine(
      (p) => {
        const sp = new URLSearchParams(p);
        for (const key of sp.keys()) {
          if (!['kinds', 'projectId', 'since', 'q', 'tag'].includes(key)) return false;
        }
        return true;
      },
      { message: 'Unsupported filter parameter' },
    ),
});

export interface SavedView {
  id: string;
  name: string;
  params: string;
}

export async function listTimelineViewsAction(): Promise<
  { ok: true; views: SavedView[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Unauthenticated' };
  const db = getDb();
  const rows = await db
    .select({
      id: timelineSavedView.id,
      name: timelineSavedView.name,
      params: timelineSavedView.params,
    })
    .from(timelineSavedView)
    .where(
      and(
        eq(timelineSavedView.workspaceId, session.user.workspaceId),
        eq(timelineSavedView.userId, session.user.id),
      ),
    )
    .orderBy(asc(timelineSavedView.createdAt))
    .limit(MAX_VIEWS);
  return { ok: true, views: rows };
}

export async function saveTimelineViewAction(input: {
  name: string;
  params: string;
}): Promise<{ ok: true; view: SavedView } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Unauthenticated' };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const db = getDb();
  const existing = await db
    .select({ id: timelineSavedView.id })
    .from(timelineSavedView)
    .where(
      and(
        eq(timelineSavedView.workspaceId, session.user.workspaceId),
        eq(timelineSavedView.userId, session.user.id),
      ),
    );
  if (existing.length >= MAX_VIEWS) return { ok: false, error: `Max ${MAX_VIEWS} saved views` };

  const [created] = await db
    .insert(timelineSavedView)
    .values({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      name: parsed.data.name,
      params: parsed.data.params,
    })
    .returning();
  if (!created) return { ok: false, error: 'Insert failed' };
  revalidatePath('/timeline');
  return { ok: true, view: { id: created.id, name: created.name, params: created.params } };
}

export async function deleteTimelineViewAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Unauthenticated' };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Invalid id' };
  const db = getDb();
  await db
    .delete(timelineSavedView)
    .where(
      and(
        eq(timelineSavedView.id, id),
        eq(timelineSavedView.workspaceId, session.user.workspaceId),
        eq(timelineSavedView.userId, session.user.id),
      ),
    );
  revalidatePath('/timeline');
  return { ok: true };
}
