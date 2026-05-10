-- Add direct goal_id field to project and decision (mirrors task.goal_id from
-- 0019). Pinning a project or decision to a goal makes it surface as evidence
-- on the goal board without needing a goal_link row.
-- Idempotent: safe to re-run via drizzle-kit push or manual replay.

ALTER TABLE "project" ADD COLUMN IF NOT EXISTS "goal_id" uuid;
ALTER TABLE "decision" ADD COLUMN IF NOT EXISTS "goal_id" uuid;

-- FKs declared here (not in the Drizzle schema) to keep schema modules
-- import-acyclic: goal.ts already imports project.ts.
DO $$
BEGIN
  ALTER TABLE "project"
    ADD CONSTRAINT "project_goal_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "decision"
    ADD CONSTRAINT "decision_goal_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "project_goal_idx" ON "project" ("goal_id");
CREATE INDEX IF NOT EXISTS "decision_goal_idx" ON "decision" ("goal_id");
