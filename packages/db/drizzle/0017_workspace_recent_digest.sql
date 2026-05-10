CREATE TABLE IF NOT EXISTS "workspace_recent_digest" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspace"("id") ON DELETE CASCADE,
  "digest" text NOT NULL DEFAULT '',
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
