-- Drop the deprecated plaintext oauth_client.webhook_secret column.
-- It was set to NULL on every insert since the hash column landed; nothing
-- reads from it. Idempotent so re-running drizzle-kit push is safe.
ALTER TABLE "oauth_client" DROP COLUMN IF EXISTS "webhook_secret";
