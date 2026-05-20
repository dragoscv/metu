-- Streaks — daily-cadence behavior tracking (kinds: abstain | do_daily | count | boolean).
-- Backs the /streaks page + dashboard streak chips.
--
-- Idempotent — every step uses IF [NOT] EXISTS or DO-block guards so that
-- running this against a database where `drizzle-kit push` already created
-- the objects (local dev) or where a partial replay is happening does not fail.

-- 1. Enum: streak_kind
DO $$
BEGIN
  CREATE TYPE "public"."streak_kind" AS ENUM ('abstain', 'do_daily', 'count', 'boolean');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Table: streak
CREATE TABLE IF NOT EXISTS "streak" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id"  uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "user_id"       uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "name"          text NOT NULL,
  "body"          text,
  "kind"          "streak_kind" NOT NULL,
  "target"        double precision,
  "unit"          text,
  "color"         text,
  "weight"        integer NOT NULL DEFAULT 3,
  "started_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at"   timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "streak_workspace_idx"      ON "streak" ("workspace_id");
CREATE INDEX IF NOT EXISTS "streak_workspace_kind_idx" ON "streak" ("workspace_id", "kind");

-- 3. Table: streak_entry — one row per (streak, day)
CREATE TABLE IF NOT EXISTS "streak_entry" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "streak_id"     uuid NOT NULL REFERENCES "streak"("id")    ON DELETE CASCADE,
  "workspace_id"  uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "day"           date NOT NULL,
  "value"         double precision NOT NULL DEFAULT 1,
  "failed"        boolean NOT NULL DEFAULT false,
  "note"          text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "streak_entry_unique_day"
  ON "streak_entry" ("streak_id", "day");

CREATE INDEX IF NOT EXISTS "streak_entry_workspace_day_idx"
  ON "streak_entry" ("workspace_id", "day");
