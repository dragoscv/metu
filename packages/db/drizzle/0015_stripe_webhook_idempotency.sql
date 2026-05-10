-- Stripe webhook idempotency log. Claims `event.id` on entry so duplicate
-- deliveries from Stripe's at-least-once retry semantics short-circuit
-- before any side effects re-run.
CREATE TABLE IF NOT EXISTS "stripe_webhook_event" (
  "event_id" text PRIMARY KEY,
  "type" text NOT NULL,
  "workspace_id" uuid,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stripe_webhook_event_received_idx" ON "stripe_webhook_event" USING btree ("received_at");
