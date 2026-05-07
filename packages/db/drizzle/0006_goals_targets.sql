-- Slice 13: goals + targets + drift detection.

DO $$ BEGIN CREATE TYPE "public"."goal_status" AS ENUM ('active', 'paused', 'achieved', 'dropped'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."goal_cadence" AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'once'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."goal_progress_mode" AS ENUM ('manual', 'from_tasks', 'from_evidence'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."goal_drift" AS ENUM ('on_track', 'slipping', 'stalled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "public"."target_period" AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'once'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "goal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "user_id" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "project_id" uuid REFERENCES "project"("id") ON DELETE SET NULL,
  "parent_goal_id" uuid,
  "title" text NOT NULL,
  "body" text,
  "status" "goal_status" NOT NULL DEFAULT 'active',
  "cadence" "goal_cadence" NOT NULL DEFAULT 'weekly',
  "progress_mode" "goal_progress_mode" NOT NULL DEFAULT 'manual',
  "progress" double precision NOT NULL DEFAULT 0,
  "drift" "goal_drift" NOT NULL DEFAULT 'on_track',
  "weight" integer NOT NULL DEFAULT 3,
  "due_at" timestamptz,
  "last_review_at" timestamptz,
  "last_progress_at" timestamptz,
  "achieved_at" timestamptz,
  "tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "goal_workspace_idx" ON "goal" ("workspace_id");
CREATE INDEX IF NOT EXISTS "goal_status_idx" ON "goal" ("status");
CREATE INDEX IF NOT EXISTS "goal_project_idx" ON "goal" ("project_id");
CREATE INDEX IF NOT EXISTS "goal_parent_idx" ON "goal" ("parent_goal_id");
CREATE INDEX IF NOT EXISTS "goal_drift_idx" ON "goal" ("drift");

CREATE TABLE IF NOT EXISTS "goal_checkin" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "goal_id" uuid NOT NULL REFERENCES "goal"("id") ON DELETE CASCADE,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "progress" double precision NOT NULL,
  "note" text,
  "created_by" text NOT NULL DEFAULT 'user',
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "goal_checkin_goal_idx" ON "goal_checkin" ("goal_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "goal_checkin_workspace_idx" ON "goal_checkin" ("workspace_id");

CREATE TABLE IF NOT EXISTS "target" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "goal_id" uuid REFERENCES "goal"("id") ON DELETE SET NULL,
  "title" text NOT NULL,
  "unit" text NOT NULL DEFAULT '',
  "target_value" double precision NOT NULL,
  "current_value" double precision NOT NULL DEFAULT 0,
  "period" "target_period" NOT NULL DEFAULT 'monthly',
  "period_start" timestamptz,
  "period_end" timestamptz,
  "status" "goal_status" NOT NULL DEFAULT 'active',
  "aggregation" text NOT NULL DEFAULT 'sum',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "target_workspace_idx" ON "target" ("workspace_id");
CREATE INDEX IF NOT EXISTS "target_goal_idx" ON "target" ("goal_id");
CREATE INDEX IF NOT EXISTS "target_status_idx" ON "target" ("status");

CREATE TABLE IF NOT EXISTS "target_value" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "target_id" uuid NOT NULL REFERENCES "target"("id") ON DELETE CASCADE,
  "value" double precision NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  "source" text NOT NULL DEFAULT 'manual',
  "note" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "target_value_target_idx" ON "target_value" ("target_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "target_value_workspace_idx" ON "target_value" ("workspace_id");

CREATE TABLE IF NOT EXISTS "goal_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "goal_id" uuid NOT NULL REFERENCES "goal"("id") ON DELETE CASCADE,
  "ref_kind" text NOT NULL,
  "ref_id" uuid NOT NULL,
  "note" text,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "goal_link_unique_idx" ON "goal_link" ("goal_id", "ref_kind", "ref_id");
CREATE INDEX IF NOT EXISTS "goal_link_workspace_idx" ON "goal_link" ("workspace_id");
CREATE INDEX IF NOT EXISTS "goal_link_ref_idx" ON "goal_link" ("ref_kind", "ref_id");
