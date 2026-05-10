-- 0021_workspace_invite.sql
-- Pending email invitations for workspaces (5A).
-- Token is sha256-hashed at rest. Single-use claim model.
--
-- Idempotent: matches the convention in 0001-0020. Safe to re-run via
-- drizzle-kit push or manual psql.

CREATE TABLE IF NOT EXISTS "workspace_invite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" "workspace_role" DEFAULT 'member' NOT NULL,
  "token_hash" text NOT NULL,
  "invited_by_user_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "claimed_at" timestamp with time zone,
  "claimed_by_user_id" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "workspace_invite"
    ADD CONSTRAINT "workspace_invite_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "workspace_invite"
    ADD CONSTRAINT "workspace_invite_invited_by_user_id_fkey"
    FOREIGN KEY ("invited_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "workspace_invite"
    ADD CONSTRAINT "workspace_invite_claimed_by_user_id_fkey"
    FOREIGN KEY ("claimed_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "workspace_invite_workspace_idx" ON "workspace_invite" ("workspace_id");
CREATE INDEX IF NOT EXISTS "workspace_invite_token_hash_idx" ON "workspace_invite" ("token_hash");
CREATE INDEX IF NOT EXISTS "workspace_invite_email_idx" ON "workspace_invite" ("email");
