'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth, signOut } from '@metu/auth';
import { getDb } from '@metu/db';
import { timelineEvent, user, workspaceMember } from '@metu/db/schema';

const updateNameSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export async function updateDisplayNameAction(
  input: z.input<typeof updateNameSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthorized' };
  const parsed = updateNameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };

  const db = getDb();
  await db.update(user).set({ name: parsed.data.name }).where(eq(user.id, session.user.id));
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'profile.updated',
    title: 'Display name updated',
    body: parsed.data.name,
  });
  revalidatePath('/settings/profile');
  return { ok: true };
}

const deleteSchema = z.object({
  confirm: z.string(),
});

/**
 * Delete the user account. The user is removed from every workspace they
 * belong to; workspaces where they were the sole owner are NOT
 * auto-deleted — we surface that in the error so the user can transfer
 * ownership or rename/delete the workspace first.
 */
export async function deleteAccountAction(input: z.input<typeof deleteSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'unauthorized' };
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success || parsed.data.confirm !== 'DELETE') {
    return { ok: false as const, error: 'type DELETE to confirm' };
  }

  const db = getDb();
  const userId = session.user.id;

  const soleOwnerWorkspaces = await db.execute(sql`
    select wm.workspace_id
    from ${workspaceMember} wm
    where wm.user_id = ${userId} and wm.role = 'owner'
      and (
        select count(*) from ${workspaceMember} wm2
        where wm2.workspace_id = wm.workspace_id and wm2.role = 'owner'
      ) = 1
  `);

  const blockers = ((soleOwnerWorkspaces as { rows?: Array<{ workspace_id: string }> }).rows ??
    (soleOwnerWorkspaces as unknown as Array<{ workspace_id: string }>)) as Array<{
    workspace_id: string;
  }>;
  if (blockers.length > 0) {
    return {
      ok: false as const,
      error: `You are the sole owner of ${blockers.length} workspace(s). Transfer ownership or delete those workspaces first.`,
    };
  }

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId,
    kind: 'account.deleted',
    title: 'Account deletion requested',
    body: session.user.email ?? userId,
  });

  await db.delete(workspaceMember).where(eq(workspaceMember.userId, userId));
  await db.delete(user).where(eq(user.id, userId));

  await signOut({ redirect: false });
  redirect('/sign-in?deleted=1');
}
