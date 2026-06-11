-- Conductor v2 (Jarvis Slice E) — session autopilot grants.
-- "Act freely for the next N hours / for this tool": while an unexpired,
-- unrevoked grant matches, resolveAcl upgrades 'ask' to 'auto_with_undo'
-- (FORCE_ASK tools excepted). Idempotent.

CREATE TABLE IF NOT EXISTS "autonomy_grant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "tool" text,
  "note" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "autonomy_grant"
    ADD CONSTRAINT "autonomy_grant_workspace_id_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "autonomy_grant_workspace_idx"
  ON "autonomy_grant" ("workspace_id", "expires_at");
