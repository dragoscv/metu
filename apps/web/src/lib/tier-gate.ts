/**
 * Plan-tier gate for Server Actions and route handlers.
 *
 * Reads the workspace's current `workspaceSubscription.tier` and either
 * permits the operation or returns a structured "needs upgrade" error
 * the UI can show as a paywall card.
 *
 * Usage in a Server Action:
 *   const gate = await requireTier(workspaceId, 'pro');
 *   if (!gate.ok) return { ok: false, error: gate.error, upsellTier: gate.minTier };
 *
 * The order is `free < pro < team`. Anything above the requested tier
 * also passes.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { workspaceSubscription } from '@metu/db/schema';

export type Tier = 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise';

const ORDER: Record<Tier, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  pro_plus: 3,
  enterprise: 4,
};

export interface TierGateOk {
  ok: true;
  tier: Tier;
}

export interface TierGateBlocked {
  ok: false;
  error: 'plan_required';
  /** What the user has now. */
  tier: Tier;
  /** What this operation needs. */
  minTier: Tier;
}

export type TierGate = TierGateOk | TierGateBlocked;

export async function getWorkspaceTier(workspaceId: string): Promise<Tier> {
  const db = getDb();
  const [row] = await db
    .select({ tier: workspaceSubscription.tier, status: workspaceSubscription.status })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, workspaceId))
    .limit(1);
  if (!row) return 'free';
  // Treat anything but `active` / `trialing` / `past_due` as free so a
  // canceled or paused sub immediately downgrades.
  if (row.status !== 'active' && row.status !== 'trialing' && row.status !== 'past_due') {
    return 'free';
  }
  const t = row.tier as Tier;
  return ORDER[t] === undefined ? 'free' : t;
}

export async function requireTier(workspaceId: string, minTier: Tier): Promise<TierGate> {
  const tier = await getWorkspaceTier(workspaceId);
  if (ORDER[tier] >= ORDER[minTier]) return { ok: true, tier };
  return { ok: false, error: 'plan_required', tier, minTier };
}
