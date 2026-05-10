/**
 * Billing — Stripe subscription tier + voice usage metering.
 *
 * Companion-Agent slice 7. Two tables:
 *   - `workspace_subscription` — one row per workspace with Stripe linkage
 *     and the monthly USD cap derived from the tier. Defaulted to `free`
 *     so existing workspaces survive without a backfill (tier=free,
 *     cap=0 means "no paid voice"; the broker still allows BYOK calls
 *     because BYOK keys are user-supplied and not metered against this).
 *   - `voice_usage` — one row per voice provider call with resolved USD
 *     cost. Aggregated via `currentMonthVoiceSpend()` for the cap check.
 *
 * Why separate from `workspace.monthly_cost_cap_usd`: that one is the
 * user-set total AI cap. `workspace_subscription.monthly_voice_usd_cap`
 * is the *tier ceiling* — the max the user is allowed to spend on
 * server-side voice routes for the active subscription.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspace } from './workspace';

export const subscriptionTier = pgEnum('subscription_tier', [
  'free',
  'starter',
  'pro',
  'pro_plus',
  'enterprise',
]);

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'incomplete',
  'paused',
]);

export const workspaceSubscription = pgTable(
  'workspace_subscription',
  {
    workspaceId: uuid('workspace_id')
      .primaryKey()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    tier: subscriptionTier('tier').notNull().default('free'),
    status: subscriptionStatus('status').notNull().default('active'),
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),
    monthlyVoiceUsdCap: numeric('monthly_voice_usd_cap', {
      precision: 10,
      scale: 2,
    })
      .notNull()
      .default('0.00'),
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true })
      .notNull()
      .default(sql`(now() + interval '30 days')`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('workspace_subscription_stripe_customer_idx').on(t.stripeCustomerId),
    index('workspace_subscription_stripe_subscription_idx').on(t.stripeSubscriptionId),
  ],
);

export const voiceLane = pgEnum('voice_lane', ['realtime', 'stt', 'tts']);

export const voiceUsage = pgTable(
  'voice_usage',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    personaSlug: text('persona_slug'),
    lane: voiceLane('lane').notNull(),
    provider: text('provider').notNull(),
    /** Audio duration when applicable (STT/TTS). */
    seconds: integer('seconds'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Resolved USD cost for this call. */
    costUsd: numeric('cost_usd', { precision: 10, scale: 5 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('voice_usage_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('voice_usage_user_idx').on(t.userId),
  ],
);

/**
 * Stripe webhook idempotency log. We claim each `event.id` (delivered by
 * Stripe with at-least-once semantics) by inserting on entry and rolling
 * back if processing fails. A second delivery of the same event short-
 * circuits before any side effects re-run.
 *
 * Rows are kept indefinitely for audit; expect <100k/yr at scale.
 */
export const stripeWebhookEvent = pgTable(
  'stripe_webhook_event',
  {
    eventId: text('event_id').primaryKey(),
    type: text('type').notNull(),
    workspaceId: uuid('workspace_id'),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('stripe_webhook_event_received_idx').on(t.receivedAt)],
);
