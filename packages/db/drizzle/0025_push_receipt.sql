-- Slice 8 (mobile push receipts): push_receipt.
-- Stores Expo push ticket IDs so a 15-minute Inngest cron can poll
-- /v2/push/getReceipts and either confirm delivery, log a transient
-- error, or disable the underlying notification_subscription on a
-- permanent failure (DeviceNotRegistered).
-- Idempotent.

CREATE TABLE IF NOT EXISTS "push_receipt" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "subscription_id" uuid NOT NULL REFERENCES "notification_subscription"("id") ON DELETE CASCADE,
  "notification_id" uuid REFERENCES "notification"("id") ON DELETE SET NULL,
  "ticket_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "error_code" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "checked_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_receipt_ticket_idx" ON "push_receipt" ("ticket_id");
CREATE INDEX IF NOT EXISTS "push_receipt_pending_idx"
  ON "push_receipt" ("status", "created_at") WHERE "status" = 'pending';
