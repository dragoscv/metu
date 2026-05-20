-- Foundations for the per-workspace OAuth-app catalog (16-connector batch):
-- 1. Tag oauth_app rows with an integration_kind so callbacks can decide
--    which `integration` row to upsert.
-- 2. Carry extra authorize-step params (e.g. access_type=offline,
--    duration=permanent) that vary per provider.
-- 3. Pick a token-endpoint auth method — most providers want
--    'client_secret_post', a few (Twitter, LinkedIn) want 'client_secret_basic'.
-- 4. Enforce one OAuth app per (workspace, kind) so the kind-based
--    callback can resolve unambiguously.
-- Idempotent — uses IF [NOT] EXISTS on every step.

DO $$ BEGIN
  ALTER TABLE "oauth_app" ADD COLUMN IF NOT EXISTS "kind" "integration_kind";
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "oauth_app"
    ADD COLUMN IF NOT EXISTS "extra_auth_params" jsonb NOT NULL DEFAULT '{}'::jsonb;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "oauth_app"
    ADD COLUMN IF NOT EXISTS "token_auth_method" text NOT NULL DEFAULT 'client_secret_post';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_app_kind_unique_idx"
  ON "oauth_app" ("workspace_id", "kind") WHERE "kind" IS NOT NULL;
