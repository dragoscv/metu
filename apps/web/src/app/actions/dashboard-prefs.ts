'use server';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { agentPolicy } from '@metu/db/schema';
import {
  DEFAULT_DASHBOARD_PREFS,
  DashboardPrefsSchema,
  type DashboardPrefs,
  type DashboardPrefsInput,
} from '@/lib/dashboard/types';

export async function getDashboardPrefsAction(): Promise<DashboardPrefs> {
  const session = await auth();
  if (!session) return DEFAULT_DASHBOARD_PREFS;
  const db = getDb();
  const [row] = await db
    .select({ metadata: agentPolicy.metadata })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, session.user.workspaceId))
    .limit(1);
  const meta = (row?.metadata ?? {}) as { dashboardPrefs?: Partial<DashboardPrefs> };
  const stored = meta.dashboardPrefs ?? {};
  return {
    ...DEFAULT_DASHBOARD_PREFS,
    ...stored,
    enabledCategories:
      stored.enabledCategories && stored.enabledCategories.length > 0
        ? stored.enabledCategories
        : DEFAULT_DASHBOARD_PREFS.enabledCategories,
  };
}

/**
 * Patch dashboardPrefs.
 *
 * Stored at `agent_policy.metadata.dashboardPrefs`. We always overwrite the
 * full object (not jsonb_set per-key) because the prefs object is small and
 * the form posts a complete shape — keeps the migration story trivial.
 */
export async function updateDashboardPrefsAction(input: DashboardPrefsInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'unauthenticated' };
  const parsed = DashboardPrefsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  const db = getDb();
  const wsId = session.user.workspaceId;

  const merged: DashboardPrefs = {
    ...(await getDashboardPrefsAction()),
    ...parsed.data,
  };

  const [existing] = await db
    .select({ id: agentPolicy.id })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, wsId))
    .limit(1);

  if (!existing) {
    await db.insert(agentPolicy).values({
      workspaceId: wsId,
      metadata: { dashboardPrefs: merged },
    });
  } else {
    await db
      .update(agentPolicy)
      .set({
        metadata: sql`jsonb_set(coalesce(${agentPolicy.metadata}, '{}'::jsonb), '{dashboardPrefs}', ${JSON.stringify(merged)}::jsonb, true)`,
      })
      .where(eq(agentPolicy.workspaceId, wsId));
  }

  revalidatePath('/dashboard');
  revalidatePath('/settings/dashboard');
  return { ok: true as const, prefs: merged };
}
