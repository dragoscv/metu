-- Slice: Presence — personas, character forms, sensory ring.
-- Idempotent (can be re-applied via drizzle-kit push).

DO $$ BEGIN
  CREATE TYPE "persona_form" AS ENUM ('panel', 'in_window', 'hud', 'pet');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "persona_proactivity" AS ENUM ('silent', 'gentle', 'active');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sensory_kind" AS ENUM (
    'screenshot', 'screen_text', 'audio_transcript', 'window_focus', 'clipboard', 'webcam'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "sensory_retention" AS ENUM ('ephemeral', 'ring_24h', 'persisted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "persona" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "system_prompt" text NOT NULL DEFAULT '',
  "voice_provider" text NOT NULL DEFAULT 'openai_realtime',
  "voice_id" text NOT NULL DEFAULT 'verse',
  "voice_tuning" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "stt_provider" text NOT NULL DEFAULT 'deepgram_nova3',
  "avatar_kind" text NOT NULL DEFAULT 'orb',
  "avatar_url" text,
  "form_prefs" jsonb NOT NULL DEFAULT '{"panel":true,"inWindow":true,"hud":true,"pet":false}'::jsonb,
  "default_form" "persona_form" NOT NULL DEFAULT 'panel',
  "wake_word" text,
  "hotkey" text,
  "proactivity" "persona_proactivity" NOT NULL DEFAULT 'gentle',
  "acl_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_built_in" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "persona_workspace_idx" ON "persona" ("workspace_id");
CREATE INDEX IF NOT EXISTS "persona_slug_idx" ON "persona" ("workspace_id", "slug");

CREATE TABLE IF NOT EXISTS "persona_activation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "persona_id" uuid NOT NULL REFERENCES "persona"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL,
  "form" "persona_form" NOT NULL,
  "position" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "started_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "persona_activation_workspace_idx" ON "persona_activation" ("workspace_id");
CREATE INDEX IF NOT EXISTS "persona_activation_device_idx" ON "persona_activation" ("device_id");

CREATE TABLE IF NOT EXISTS "sensory_ring" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "device_id" uuid NOT NULL,
  "kind" "sensory_kind" NOT NULL,
  "summary" text NOT NULL DEFAULT '',
  "storage_key" text,
  "retention" "sensory_retention" NOT NULL DEFAULT 'ring_24h',
  "occurred_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "sensory_ring_workspace_idx" ON "sensory_ring" ("workspace_id");
CREATE INDEX IF NOT EXISTS "sensory_ring_device_idx" ON "sensory_ring" ("device_id");
CREATE INDEX IF NOT EXISTS "sensory_ring_occurred_idx" ON "sensory_ring" ("workspace_id", "occurred_at");
