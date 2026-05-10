'use server';
/**
 * Workspace switcher.
 *
 * Sets a long-lived cookie (`metu.workspace`) pinning the user's active
 * workspace. The Auth.js session callback in `@metu/auth` reads this
 * cookie on every request and uses it to populate `session.user.workspaceId`
 * — provided the user is still a member.
 *
 * Cookie-based instead of a DB column on `user` because:
 *   - per-tab/per-browser scoping is desirable (you can have two
 *     workspaces open in two windows, though only one wins for the
 *     active session at a time)
 *   - no migration required
 *   - clean signOut: cookie is on the auth cookie domain
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { auth, ACTIVE_WORKSPACE_COOKIE } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspaceMember } from '@metu/db/schema';
import { log } from '@/lib/logger';

const SwitchSchema = z.object({ workspaceId: z.string().uuid() });

export type SwitchWorkspaceResult =
  | { ok: true; workspaceId: string }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'not_member' };

export async function switchWorkspaceAction(
  input: z.infer<typeof SwitchSchema>,
): Promise<SwitchWorkspaceResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'unauthorized' };

  const parsed = SwitchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };

  const { workspaceId } = parsed.data;
  const db = getDb();
  const [member] = await db
    .select({ workspaceId: workspaceMember.workspaceId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, error: 'not_member' };

  const c = await cookies();
  c.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year — refreshed on every switch.
  });

  log.info('workspace.switched', {
    fromWorkspaceId: session.user.workspaceId,
    toWorkspaceId: workspaceId,
    userId: session.user.id,
  });

  // Re-render every authenticated route — the layout's session-based
  // workspace gate may now route to a different page.
  revalidatePath('/', 'layout');
  return { ok: true, workspaceId };
}
