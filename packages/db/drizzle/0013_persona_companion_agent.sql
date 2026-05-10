-- 0013 — Companion-Agent slice 2: persona localization, cost tier, mode + eagerness scalar.
-- All additions are nullable / defaulted so existing rows survive a re-run.
-- Idempotent (safe to re-apply via drizzle-kit push).

DO $$ BEGIN
  CREATE TYPE "persona_mode" AS ENUM (
    'silent', 'ambient_nudges', 'anticipatory', 'autonomous'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "persona_cost_tier" AS ENUM ('budget', 'balanced', 'premium');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "persona"
  ADD COLUMN IF NOT EXISTS "language" text NOT NULL DEFAULT 'en';

ALTER TABLE "persona"
  ADD COLUMN IF NOT EXISTS "cost_tier" "persona_cost_tier" NOT NULL DEFAULT 'balanced';

ALTER TABLE "persona"
  ADD COLUMN IF NOT EXISTS "mode" "persona_mode" NOT NULL DEFAULT 'ambient_nudges';

-- 0..100 scalar; biases planner thresholds independently of `mode`.
ALTER TABLE "persona"
  ADD COLUMN IF NOT EXISTS "eagerness" smallint NOT NULL DEFAULT 50;

DO $$ BEGIN
  ALTER TABLE "persona"
    ADD CONSTRAINT "persona_eagerness_range_chk"
    CHECK ("eagerness" >= 0 AND "eagerness" <= 100);
EXCEPTION WHEN duplicate_object THEN null; END $$;
