-- Slice 11: intent mirroring — satellite apps push actionable items into METU's task table.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "source_app" text;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "source_entity_ref" jsonb;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "source_url" text;

CREATE INDEX IF NOT EXISTS "task_source_app_idx" ON "task" ("source_app");
