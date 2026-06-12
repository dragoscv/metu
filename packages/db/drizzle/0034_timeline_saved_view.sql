-- Per-user saved timeline views (Round 12). Idempotent.

CREATE TABLE IF NOT EXISTS "timeline_saved_view" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "params" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "timeline_saved_view_ws_user_idx"
  ON "timeline_saved_view" ("workspace_id", "user_id");
