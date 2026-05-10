'use server';
/**
 * Billing actions — companion-agent slice 7b.
 *
 * Owns the Stripe Checkout / Customer Portal entry points and reads the
 * current subscription state for the settings page. Webhook
 * (`/api/webhooks/stripe`) keeps `workspace_subscription` in sync.
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspaceSubscription, timelineEvent, voiceUsage } from '@metu/db/schema';
import { stripe } from '@metu/integrations';
import { and, gte, sql } from 'drizzle-orm';

export type BillingTier = 'free' | 'starter' | 'pro' | 'pro_plus' | 'enterprise';

export type BillingTierOption = {
  tier: BillingTier;
  name: string;
  priceUsd: number;
  capUsd: number;
  highlights: string[];
  /** Stripe price id resolved from env at request time. Undefined ⇒ tier disabled. */
  priceId: string | undefined;
};

export async function listBillingTiers(): Promise<BillingTierOption[]> {
  const env = process.env;
  return [
    {
      tier: 'free',
      name: 'Free',
      priceUsd: 0,
      capUsd: 0,
      highlights: ['Bring your own keys', 'No metered voice', 'Local + open source providers'],
      priceId: undefined,
    },
    {
      tier: 'starter',
      name: 'Starter',
      priceUsd: 9,
      capUsd: 3,
      highlights: ['$3/mo voice budget', 'All personas', 'Email + push'],
      priceId: env.STRIPE_PRICE_STARTER,
    },
    {
      tier: 'pro',
      name: 'Pro',
      priceUsd: 29,
      capUsd: 15,
      highlights: ['$15/mo voice budget', 'Premium voices (ElevenLabs)', 'Priority models'],
      priceId: env.STRIPE_PRICE_PRO,
    },
    {
      tier: 'pro_plus',
      name: 'Pro Plus',
      priceUsd: 79,
      capUsd: 50,
      highlights: ['$50/mo voice budget', 'Realtime always-on', 'Advanced device automation'],
      priceId: env.STRIPE_PRICE_PRO_PLUS,
    },
    {
      tier: 'enterprise',
      name: 'Enterprise',
      priceUsd: 249,
      capUsd: 200,
      highlights: ['$200/mo voice budget', 'SSO', 'White-glove onboarding'],
      priceId: env.STRIPE_PRICE_ENTERPRISE,
    },
  ];
}

export type CurrentSubscription = {
  tier: BillingTier;
  status: string;
  capUsd: number;
  hasStripeCustomer: boolean;
};

export async function getCurrentSubscription(): Promise<CurrentSubscription> {
  const session = await auth();
  if (!session) {
    return { tier: 'free', status: 'active', capUsd: 0, hasStripeCustomer: false };
  }
  const db = getDb();
  const [row] = await db
    .select()
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, session.user.workspaceId))
    .limit(1);
  if (!row) {
    return { tier: 'free', status: 'active', capUsd: 0, hasStripeCustomer: false };
  }
  return {
    tier: row.tier,
    status: row.status,
    capUsd: Number(row.monthlyVoiceUsdCap),
    hasStripeCustomer: !!row.stripeCustomerId,
  };
}

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const tier = formData.get('tier') as BillingTier | null;
  if (!tier) throw new Error('missing_tier');
  const session = await auth();
  if (!session) throw new Error('unauthenticated');

  const opt = (await listBillingTiers()).find((t) => t.tier === tier);
  if (!opt?.priceId) throw new Error('tier_not_available');

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:24890';

  const checkout = await stripe.stripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: opt.priceId, quantity: 1 }],
    success_url: `${baseUrl}/settings/billing?ok=1`,
    cancel_url: `${baseUrl}/settings/billing?cancelled=1`,
    customer_email: session.user.email ?? undefined,
    client_reference_id: session.user.workspaceId,
    metadata: {
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
      tier,
    },
    subscription_data: {
      metadata: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        tier,
      },
    },
  });
  if (!checkout.url) throw new Error('checkout_no_url');
  redirect(checkout.url);
}

export async function openPortalAction(): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const db = getDb();
  const [row] = await db
    .select({ customerId: workspaceSubscription.stripeCustomerId })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, session.user.workspaceId))
    .limit(1);
  if (!row?.customerId) throw new Error('no_customer');
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:24890';
  const portal = await stripe.stripe().billingPortal.sessions.create({
    customer: row.customerId,
    return_url: `${baseUrl}/settings/billing`,
  });
  redirect(portal.url);
}

/**
 * Dev-only: seed `workspace_subscription` to a chosen tier without going
 * through Stripe. Lets us QA cap meters, billing UI, and Conductor cost
 * gating end-to-end before wiring real prices. Hard-disabled in production.
 *
 * Capped at the same USD numbers the real webhook would set so the
 * cap meter reads identically.
 */
const TIER_CAPS: Record<BillingTier, string> = {
  free: '0.00',
  starter: '3.00',
  pro: '15.00',
  pro_plus: '50.00',
  enterprise: '200.00',
};

export async function simulateSubscriptionAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('simulate_disabled_in_production');
  }
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const tier = (formData.get('tier') as BillingTier | null) ?? 'free';
  const capUsd = TIER_CAPS[tier];
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const db = getDb();
  await db
    .insert(workspaceSubscription)
    .values({
      workspaceId: session.user.workspaceId,
      tier,
      status: 'active',
      stripeCustomerId: 'cus_dev_simulated',
      stripeSubscriptionId: `sub_dev_${tier}_${Date.now()}`,
      stripePriceId: `price_dev_${tier}`,
      monthlyVoiceUsdCap: capUsd,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    })
    .onConflictDoUpdate({
      target: workspaceSubscription.workspaceId,
      set: {
        tier,
        status: 'active',
        monthlyVoiceUsdCap: capUsd,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    kind: 'subscription.updated',
    title: `Simulated ${tier} subscription`,
    body: `Dev override: voice cap set to $${capUsd}/mo for QA. Bypassed Stripe.`,
    payload: { tier, capUsd, simulated: true },
    importance: 0.3,
  });
}

export interface VoiceUsageDayBucket {
  /** YYYY-MM-DD in UTC. */
  day: string;
  realtimeUsd: number;
  sttUsd: number;
  ttsUsd: number;
  totalUsd: number;
}

/**
 * Read voice spend per day per lane for the last `days` days. Used by the
 * billing page chart and (eventually) by a CSV export. Aggregated server-side
 * to keep the row count tiny.
 */
export async function getVoiceUsageDailyAction(days = 14): Promise<VoiceUsageDayBucket[]> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const db = getDb();
  const rows = await db
    .select({
      day: sql<string>`to_char(${voiceUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      lane: voiceUsage.lane,
      cost: sql<string>`sum(${voiceUsage.costUsd})`,
    })
    .from(voiceUsage)
    .where(
      and(eq(voiceUsage.workspaceId, session.user.workspaceId), gte(voiceUsage.createdAt, since)),
    )
    .groupBy(
      sql`to_char(${voiceUsage.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      voiceUsage.lane,
    );

  const byDay = new Map<string, VoiceUsageDayBucket>();
  // Pre-fill every day in the window so the chart has zero baselines.
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    byDay.set(key, { day: key, realtimeUsd: 0, sttUsd: 0, ttsUsd: 0, totalUsd: 0 });
  }
  for (const r of rows) {
    const bucket = byDay.get(r.day) ?? {
      day: r.day,
      realtimeUsd: 0,
      sttUsd: 0,
      ttsUsd: 0,
      totalUsd: 0,
    };
    const cost = Number.parseFloat(r.cost) || 0;
    if (r.lane === 'realtime') bucket.realtimeUsd += cost;
    else if (r.lane === 'stt') bucket.sttUsd += cost;
    else if (r.lane === 'tts') bucket.ttsUsd += cost;
    bucket.totalUsd = bucket.realtimeUsd + bucket.sttUsd + bucket.ttsUsd;
    byDay.set(r.day, bucket);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * CSV download for the current month. One row per `voice_usage` entry,
 * sorted oldest → newest. Used by the "Export CSV" button on the billing
 * page; route writes the same data via a Server Action that returns text
 * and the page wraps it in a `<a download>`.
 */
export async function getVoiceUsageCsvAction(): Promise<string> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const db = getDb();
  const rows = await db
    .select({
      createdAt: voiceUsage.createdAt,
      personaSlug: voiceUsage.personaSlug,
      lane: voiceUsage.lane,
      provider: voiceUsage.provider,
      seconds: voiceUsage.seconds,
      inputTokens: voiceUsage.inputTokens,
      outputTokens: voiceUsage.outputTokens,
      costUsd: voiceUsage.costUsd,
    })
    .from(voiceUsage)
    .where(
      and(
        eq(voiceUsage.workspaceId, session.user.workspaceId),
        gte(voiceUsage.createdAt, startOfMonth),
      ),
    )
    .orderBy(voiceUsage.createdAt);

  const header =
    'created_at,persona_slug,lane,provider,seconds,input_tokens,output_tokens,cost_usd';
  const lines = rows.map((r) =>
    [
      r.createdAt.toISOString(),
      r.personaSlug ?? '',
      r.lane,
      r.provider,
      r.seconds ?? '',
      r.inputTokens ?? '',
      r.outputTokens ?? '',
      r.costUsd,
    ].join(','),
  );
  return [header, ...lines].join('\n');
}
