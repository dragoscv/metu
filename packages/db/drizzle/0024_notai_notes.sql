-- Slice 7 (notai backing store): notai_folder + notai_note.
-- Notes live in metu's Postgres so notai stays a thin SDK consumer; metu
-- captures are the second-brain mirror (see notai_note.last_synced_capture_id).
-- Idempotent.

CREATE TABLE IF NOT EXISTS "notai_folder" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "parent_id" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "notai_folder_ws_user_idx" ON "notai_folder" ("workspace_id", "user_id");

CREATE TABLE IF NOT EXISTS "notai_note" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "folder_id" uuid REFERENCES "notai_folder"("id") ON DELETE SET NULL,
  "title" text NOT NULL DEFAULT 'Untitled',
  "body" text NOT NULL DEFAULT '',
  "pinned" boolean NOT NULL DEFAULT false,
  "last_synced_capture_id" uuid REFERENCES "capture"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "notai_note_ws_user_idx" ON "notai_note" ("workspace_id", "user_id");
CREATE INDEX IF NOT EXISTS "notai_note_folder_idx" ON "notai_note" ("folder_id");
