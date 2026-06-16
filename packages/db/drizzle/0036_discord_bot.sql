-- Discord BYO bot. Idempotent (see metu migration convention).

CREATE TABLE IF NOT EXISTS "discord_bot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "application_id" text NOT NULL,
  "public_key" text NOT NULL,
  "token_ciphertext" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_tag" text NOT NULL,
  "key_ref" text DEFAULT 'master' NOT NULL,
  "bot_username" text,
  "bot_id" text,
  "allowed_discord_user_id" text,
  "dm_channel_id" text,
  "connected_by_user_id" uuid NOT NULL,
  "outbound_enabled" boolean DEFAULT true NOT NULL,
  "tone" text DEFAULT 'chief_of_staff' NOT NULL,
  "daily_cap" integer DEFAULT 5 NOT NULL,
  "min_gap_minutes" integer DEFAULT 90 NOT NULL,
  "sent_today" integer DEFAULT 0 NOT NULL,
  "sent_today_date" text,
  "last_proactive_at" timestamp with time zone,
  "muted_until" timestamp with time zone,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "discord_bot"
    ADD CONSTRAINT "discord_bot_workspace_id_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspace"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "discord_bot_workspace_unique_idx" ON "discord_bot" ("workspace_id");
CREATE INDEX IF NOT EXISTS "discord_bot_application_idx" ON "discord_bot" ("application_id");
