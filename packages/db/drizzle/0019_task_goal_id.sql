-- Add task.goal_id (nullable) so a task can be a first-class milestone of a
-- goal, separate from the generic goal_link evidence relation.
-- Idempotent: safe to re-run via drizzle-kit push or manual replay.

ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "goal_id" uuid;

-- FK declared here (not in the Drizzle schema) to keep schema modules
-- import-acyclic: goal.ts already imports project.ts for projectId.
DO $$
BEGIN
  ALTER TABLE "task"
    ADD CONSTRAINT "task_goal_id_fk"
    FOREIGN KEY ("goal_id") REFERENCES "goal"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "task_goal_idx" ON "task" ("goal_id");
