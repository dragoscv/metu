-- 0014 — Companion-Agent slice 7: voice usage metering + Stripe subscription tier.
-- Idempotent (safe to re-apply via drizzle-kit push).

-- ── workspace_subscription ────────────────────────────────────────────────
-- One row per workspace tracking the Stripe subscription that gates the
-- monthly cap + persona cost tier ceiling. Independent of the
-- `monthly_cost_cap_usd` column on `workspace` (which is the user-set cap);
-- subscription tier defines the *allowed* cap range.

DO $$ BEGIN
  CREATE TYPE "subscription_tier" AS ENUM (
    'free', 'starter', 'pro', 'pro_plus', 'enterprise'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM (
    'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "workspace_subscription" (
  "workspace_id" uuid PRIMARY KEY
    REFERENCES "workspace"("id") ON DELETE CASCADE,
  "tier" "subscription_tier" NOT NULL DEFAULT 'free',
  "status" "subscription_status" NOT NULL DEFAULT 'active',
  -- Stripe linkage (nullable — `free` tier has no Stripe row).
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_price_id" text,
  -- USD/month cap derived from tier (denormalized for fast cap checks).
  "monthly_voice_usd_cap" numeric(10, 2) NOT NULL DEFAULT 0.00,
  -- Current period anchors (mirror Stripe period_start/end on free we roll monthly).
  "current_period_start" timestamptz NOT NULL DEFAULT now(),
  "current_period_end" timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "workspace_subscription_stripe_customer_idx"
  ON "workspace_subscription" ("stripe_customer_id");
CREATE INDEX IF NOT EXISTS "workspace_subscription_stripe_subscription_idx"
  ON "workspace_subscription" ("stripe_subscription_id");

-- ── voice_usage ───────────────────────────────────────────────────────────
-- Per-call usage event. Inserted by the broker routes (transcribe, speak,
-- realtime/session) right after the upstream provider returns. Aggregated
-- in-query by `currentMonthVoiceSpend()` so we don't need a rollup job.

DO $$ BEGIN
  CREATE TYPE "voice_lane" AS ENUM ('realtime', 'stt', 'tts');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "voice_usage" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL
    REFERENCES "workspace"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL,
  "persona_slug" text,
  "lane" "voice_lane" NOT NULL,
  "provider" text NOT NULL,
  -- Either seconds (audio duration) OR tokens (LLM realtime). At least one set.
  "seconds" integer,
  "input_tokens" integer,
  "output_tokens" integer,
  -- Resolved USD cost (provider-billed, computed at insert time).
  "cost_usd" numeric(10, 5) NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "voice_usage_workspace_created_idx"
  ON "voice_usage" ("workspace_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "voice_usage_user_idx"
  ON "voice_usage" ("user_id");
