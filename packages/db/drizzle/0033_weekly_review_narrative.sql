-- Week-in-review narrative cache (Round 11 feature slice). Idempotent.

CREATE TABLE IF NOT EXISTS "weekly_review_narrative" (
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE cascade,
  "window_days" integer NOT NULL DEFAULT 7,
  "narrative" text NOT NULL,
  "inputs_hash" text NOT NULL DEFAULT '',
  "model_provider" text,
  "model_id" text,
  "generated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "weekly_review_narrative_pk" PRIMARY KEY ("workspace_id", "window_days")
);
