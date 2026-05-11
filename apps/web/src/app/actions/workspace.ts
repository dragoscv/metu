'use server';

import { auth } from '@metu/auth';
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { workspace, workspaceMember, timelineEvent } from '@metu/db/schema';
import { revalidatePath } from 'next/cache';

const slugRe = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugRe, 'lowercase letters, numbers, hyphens; 1–32 chars; no leading/trailing hyphen'),
});

export async function updateWorkspaceAction(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return { ok: false, error: 'forbidden' };
  }

  // Reject slug collision (case-insensitive — DB has its own unique idx
  // but the safeguard gives a friendlier message).
  const [collision] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.slug, parsed.data.slug), ne(workspace.id, workspaceId)))
    .limit(1);
  if (collision) return { ok: false, error: 'slug_taken' };

  await db
    .update(workspace)
    .set({ name: parsed.data.name, slug: parsed.data.slug })
    .where(eq(workspace.id, workspaceId));

  await db.insert(timelineEvent).values({
    workspaceId,
    userId: session.user.id,
    kind: 'workspace.settings.updated',
    title: `Workspace renamed to "${parsed.data.name}"`,
    payload: { name: parsed.data.name, slug: parsed.data.slug },
    importance: 0.4,
    occurredAt: sql`now()`,
  });

  revalidatePath('/settings/workspace');
  revalidatePath('/');
  return { ok: true };
}
