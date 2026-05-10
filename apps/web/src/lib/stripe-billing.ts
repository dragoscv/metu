/**
 * Pure helpers for the Stripe webhook → workspace_subscription upsert.
 *
 * Extracted from `app/api/webhooks/stripe/route.ts` so they can be tested
 * in isolation without spinning up Next/Drizzle/Stripe runtimes. The route
 * is now a thin shell that delegates to `buildSubscriptionUpsertValues`.
 */
import type Stripe from 'stripe';

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'paused';

const KNOWN_STATUSES = new Set<SubscriptionStatus>([
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'paused',
]);

export function normaliseStatus(s: string): SubscriptionStatus {
  return (KNOWN_STATUSES as Set<string>).has(s) ? (s as SubscriptionStatus) : 'incomplete';
}

/**
 * Snapshot of `process.env.STRIPE_PRICE_*` at call time. Pass an explicit
 * `env` from tests to avoid touching `process.env`.
 */
export function priceMap(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, { tier: SubscriptionTier; capUsd: string }> {
  const map: Record<string, { tier: SubscriptionTier; capUsd: string }> = {};
  if (env.STRIPE_PRICE_STARTER) map[env.STRIPE_PRICE_STARTER] = { tier: 'starter', capUsd: '3.00' };
  if (env.STRIPE_PRICE_PRO) map[env.STRIPE_PRICE_PRO] = { tier: 'pro', capUsd: '15.00' };
  if (env.STRIPE_PRICE_PRO_PLUS)
    map[env.STRIPE_PRICE_PRO_PLUS] = { tier: 'pro_plus', capUsd: '50.00' };
  if (env.STRIPE_PRICE_ENTERPRISE)
    map[env.STRIPE_PRICE_ENTERPRISE] = { tier: 'enterprise', capUsd: '200.00' };
  return map;
}

/**
 * Walks the subscription + customer payload looking for our `workspaceId`
 * tag. Production paths set it on `subscription.metadata`; defensive
 * fallback reads `subscription.customer.metadata` for older Stripe
 * accounts that only have it on the Customer.
 */
export function extractWorkspaceId(sub: Stripe.Subscription): string | null {
  const fromSub = (sub.metadata?.workspaceId as string | undefined) ?? null;
  if (fromSub) return fromSub;
  if (typeof sub.customer === 'object' && sub.customer && 'metadata' in sub.customer) {
    const m = (sub.customer as { metadata?: { workspaceId?: string } }).metadata;
    return m?.workspaceId ?? null;
  }
  return null;
}

export interface SubscriptionUpsertValues {
  workspaceId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  monthlyVoiceUsdCap: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

/**
 * Translate a Stripe Subscription into the shape the `workspace_subscription`
 * upsert expects. Returns `null` when no `workspaceId` can be resolved (a
 * misconfigured subscription that we should log + skip, not fail).
 *
 * Period bounds live on the subscription itself (older SDK shape) or on
 * the item (newer split-billing). Falls back to a 30-day window from `now`.
 */
export function buildSubscriptionUpsertValues(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): SubscriptionUpsertValues | null {
  const workspaceId = extractWorkspaceId(sub);
  if (!workspaceId) return null;
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const mapped = priceId ? priceMap(env)[priceId] : undefined;
  const tier = mapped?.tier ?? 'free';
  const capUsd = mapped?.capUsd ?? '0.00';
  const status = normaliseStatus(sub.status);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const subAny = sub as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const itemAny = item as
    | (typeof item & {
        current_period_start?: number;
        current_period_end?: number;
      })
    | undefined;
  const startSec = subAny.current_period_start ?? itemAny?.current_period_start;
  const endSec = subAny.current_period_end ?? itemAny?.current_period_end;
  const currentPeriodStart = startSec ? new Date(startSec * 1000) : now;
  const currentPeriodEnd = endSec
    ? new Date(endSec * 1000)
    : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    workspaceId,
    tier,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId ?? null,
    monthlyVoiceUsdCap: capUsd,
    currentPeriodStart,
    currentPeriodEnd,
  };
}
