-- Slice 9 (hub DLQ): hub_dlq_envelope.
-- When `hubBroadcast()` fails (network, 5xx, timeout, or all peer hubs
-- reject), persist the envelope here so an operator can replay it after
-- the cause is fixed. Idempotent.

CREATE TABLE IF NOT EXISTS "hub_dlq_envelope" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "kinds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "device_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "envelope" jsonb NOT NULL,
  "reason" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 1,
  "last_attempt_at" timestamp with time zone NOT NULL DEFAULT now(),
  "replayed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hub_dlq_pending_idx"
  ON "hub_dlq_envelope" ("workspace_id", "created_at") WHERE "replayed_at" IS NULL;
