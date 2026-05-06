'use server';
import { revalidatePath } from 'next/cache';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { agentPolicy, toolAcl, workspace } from '@metu/db/schema';

const autonomyMode = z.enum(['observe', 'ask', 'auto_with_undo', 'autopilot']);

const updatePolicySchema = z.object({
  defaultMode: autonomyMode.optional(),
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
});

export async function setToolAclAction(input: z.infer<typeof setToolAclSchema>) {
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

  const [existing] = await db
    .select({ id: toolAcl.id })
    .from(toolAcl)
    .where(and(eq(toolAcl.workspaceId, wsId), eq(toolAcl.tool, parsed.data.tool)))
    .limit(1);

  if (existing) {
    await db.update(toolAcl).set({ mode: parsed.data.mode }).where(eq(toolAcl.id, existing.id));
  } else {
    await db.insert(toolAcl).values({
      workspaceId: wsId,
      tool: parsed.data.tool,
      mode: parsed.data.mode,
    });
  }

  revalidatePath('/settings/autonomy');
  return { ok: true as const };
}

export async function clearToolAclAction(tool: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(toolAcl)
    .where(and(eq(toolAcl.workspaceId, session.user.workspaceId), eq(toolAcl.tool, tool)));
  revalidatePath('/settings/autonomy');
  return { ok: true as const };
}
