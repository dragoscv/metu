'use server';
/**
 * Calendar feed (6G) — opaque per-workspace token stored at
 * `workspace.preferences.calendarFeedToken`. Owners can rotate or
 * disable the token. The URL served at `/api/calendar/goals/[token].ics`
 * looks up the workspace by this value and emits an iCalendar feed of
 * goal deadlines.
 *
 * The token is the only credential: rotating it invalidates any
 * calendar subscription that had the previous URL.
 */
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspace, workspaceMember } from '@metu/db/schema';

async function requireOwnerOrAdmin(): Promise<
  { ok: true; workspaceId: string } | { ok: false; error: 'unauthenticated' | 'forbidden' }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const db = getDb();
  const [me] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      sql`${workspaceMember.userId} = ${session.user.id} and ${workspaceMember.workspaceId} = ${session.user.workspaceId}`,
    )
    .limit(1);
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, workspaceId: session.user.workspaceId };
}

export async function getCalendarFeedToken(): Promise<string | null> {
  const session = await auth();
  if (!session) return null;
  const db = getDb();
  const [row] = await db
    .select({ preferences: workspace.preferences })
    .from(workspace)
    .where(eq(workspace.id, session.user.workspaceId))
    .limit(1);
  const prefs = (row?.preferences ?? {}) as { calendarFeedToken?: string };
  return typeof prefs.calendarFeedToken === 'string' && prefs.calendarFeedToken.length > 0
    ? prefs.calendarFeedToken
    : null;
}

export async function rotateCalendarFeedTokenAction(): Promise<
  { ok: true; token: string } | { ok: false; error: 'unauthenticated' | 'forbidden' }
> {
  const guard = await requireOwnerOrAdmin();
  if (!guard.ok) return guard;
  const token = randomBytes(24).toString('base64url');
  const db = getDb();
  await db
    .update(workspace)
    .set({
      preferences: sql`jsonb_set(coalesce(${workspace.preferences}, '{}'::jsonb), '{calendarFeedToken}', to_jsonb(${token}::text))`,
    })
    .where(eq(workspace.id, guard.workspaceId));
  revalidatePath('/settings/data');
  return { ok: true, token };
}

export async function disableCalendarFeedAction(): Promise<
  { ok: true } | { ok: false; error: 'unauthenticated' | 'forbidden' }
> {
  const guard = await requireOwnerOrAdmin();
  if (!guard.ok) return guard;
  const db = getDb();
  await db
    .update(workspace)
    .set({
      preferences: sql`(coalesce(${workspace.preferences}, '{}'::jsonb)) - 'calendarFeedToken'`,
    })
    .where(eq(workspace.id, guard.workspaceId));
  revalidatePath('/settings/data');
  return { ok: true };
}
