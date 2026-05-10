'use server';
import { revalidatePath } from 'next/cache';
import { eq, and, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { agentPolicy, timelineEvent, toolAcl, workspace } from '@metu/db/schema';

const autonomyMode = z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot']);

const updatePolicySchema = z.object({
  defaultMode: autonomyMode.optional(),
  enabled: z.boolean().optional(),
  notificationLevel: z.number().int().min(0).max(100).optional(),
  dailyCostCapUsd: z.number().min(0).max(10000).nullable().optional(),
  dailyActionCap: z.number().int().min(0).max(10000).nullable().optional(),
  tickIntervalSec: z.number().int().min(60).max(86400).optional(),
  unlimitedAi: z.boolean().optional(),
});

export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;

export async function updateAutonomyPolicyAction(input: UpdatePolicyInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = updatePolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Invalid',
    };
  }
  const db = getDb();
  const wsId = session.user.workspaceId;

  // Upsert policy
  const [existing] = await db
    .select({ id: agentPolicy.id })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, wsId))
    .limit(1);

  const policyPatch = {
    defaultMode: parsed.data.defaultMode,
    enabled: parsed.data.enabled,
    notificationLevel: parsed.data.notificationLevel,
    dailyCostCapUsd: parsed.data.dailyCostCapUsd,
    dailyActionCap: parsed.data.dailyActionCap,
    tickIntervalSec: parsed.data.tickIntervalSec,
  };

  if (existing) {
    await db
      .update(agentPolicy)
      .set(Object.fromEntries(Object.entries(policyPatch).filter(([, v]) => v !== undefined)))
      .where(eq(agentPolicy.workspaceId, wsId));
  } else {
    await db.insert(agentPolicy).values({ workspaceId: wsId, ...policyPatch });
  }

  if (parsed.data.unlimitedAi !== undefined) {
    await db
      .update(workspace)
      .set({ unlimitedAi: parsed.data.unlimitedAi })
      .where(eq(workspace.id, wsId));
  }

  revalidatePath('/settings/autonomy');
  return { ok: true as const };
}

const setToolAclSchema = z.object({
  tool: z.string().min(1).max(64),
  mode: autonomyMode,
  /** When provided, the override is scoped to that integration only. */
  integrationId: z.string().uuid().nullable().optional(),
  /**
   * Where the change came from. Powers timeline instrumentation so we
   * can later answer "how often does the cost-warning nudge actually
   * convert?". Default `manual` matches the existing user-driven
   * <select> path — not logged.
   */
  source: z.enum(['manual', 'cost_warning_downgrade']).optional().default('manual'),
});

export async function setToolAclAction(input: z.input<typeof setToolAclSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = setToolAclSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? 'Invalid',
    };
  }
  const db = getDb();
  const wsId = session.user.workspaceId;
  const integrationId = parsed.data.integrationId ?? null;

  const [existing] = await db
    .select({ id: toolAcl.id, mode: toolAcl.mode })
    .from(toolAcl)
    .where(
      and(
        eq(toolAcl.workspaceId, wsId),
        eq(toolAcl.tool, parsed.data.tool),
        integrationId ? eq(toolAcl.integrationId, integrationId) : isNull(toolAcl.integrationId),
      ),
    )
    .limit(1);

  const previousMode = existing?.mode ?? null;

  if (existing) {
    await db.update(toolAcl).set({ mode: parsed.data.mode }).where(eq(toolAcl.id, existing.id));
  } else {
    await db.insert(toolAcl).values({
      workspaceId: wsId,
      tool: parsed.data.tool,
      mode: parsed.data.mode,
      integrationId,
    });
  }

  // Instrumentation: only log when the user took the warning's
  // "Switch to <baseline>" action. Manual select changes stay quiet
  // to avoid timeline noise on routine config tweaks.
  if (parsed.data.source === 'cost_warning_downgrade') {
    await db.insert(timelineEvent).values({
      workspaceId: wsId,
      userId: session.user.id,
      kind: 'autonomy.cost_warning_accepted',
      title: `Downgraded ${parsed.data.tool} to ${parsed.data.mode}`,
      body: previousMode
        ? `Was '${previousMode}', set to '${parsed.data.mode}' from autopilot cost warning.`
        : `Inherited default; pinned to '${parsed.data.mode}' from autopilot cost warning.`,
      importance: 0.3,
      payload: {
        tool: parsed.data.tool,
        previousMode,
        newMode: parsed.data.mode,
        integrationId,
        source: 'cost_warning_downgrade',
      },
    });
  }

  revalidatePath('/settings/autonomy');
  return { ok: true as const };
}

const clearToolAclSchema = z.object({
  tool: z.string().min(1).max(64),
  integrationId: z.string().uuid().nullable().optional(),
});

export async function clearToolAclAction(input: string | z.infer<typeof clearToolAclSchema>) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  // Backwards-compatible: accept a bare tool-name string.
  const normalized = typeof input === 'string' ? { tool: input } : input;
  const parsed = clearToolAclSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  const db = getDb();
  const integrationId = parsed.data.integrationId ?? null;
  await db
    .delete(toolAcl)
    .where(
      and(
        eq(toolAcl.workspaceId, session.user.workspaceId),
        eq(toolAcl.tool, parsed.data.tool),
        integrationId ? eq(toolAcl.integrationId, integrationId) : isNull(toolAcl.integrationId),
      ),
    );
  revalidatePath('/settings/autonomy');
  return { ok: true as const };
}
