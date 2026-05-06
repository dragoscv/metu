-- Slice 9: oauth chain revocation, webhook secret hashing, agent_policy kill-switch.
ALTER TABLE "agent_policy" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "oauth_client" ADD COLUMN IF NOT EXISTS "webhook_secret_hash" text;
ALTER TABLE "oauth_token" ADD COLUMN IF NOT EXISTS "token_family_id" uuid;
CREATE INDEX IF NOT EXISTS "oauth_token_family_idx" ON "oauth_token" ("token_family_id");
