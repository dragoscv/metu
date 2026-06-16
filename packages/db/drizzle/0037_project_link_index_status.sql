-- Repo indexing lifecycle on project_link. Idempotent.

ALTER TABLE "project_link" ADD COLUMN IF NOT EXISTS "index_status" text;
ALTER TABLE "project_link" ADD COLUMN IF NOT EXISTS "index_queued_at" timestamp with time zone;
ALTER TABLE "project_link" ADD COLUMN IF NOT EXISTS "index_started_at" timestamp with time zone;
ALTER TABLE "project_link" ADD COLUMN IF NOT EXISTS "indexed_at" timestamp with time zone;
ALTER TABLE "project_link" ADD COLUMN IF NOT EXISTS "index_error" text;
