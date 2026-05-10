-- 0012_oauth_token_last_used.sql
-- Adds oauth_token.last_used_at, used by the SDK auth path to expose
-- "last seen" presence for SDK-only clients (browser-ext, mcp-server,
-- mobile background) on /apps. Idempotent.
DO $$
BEGIN
  ALTER TABLE oauth_token ADD COLUMN last_used_at timestamptz;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS oauth_token_last_used_at_idx
  ON oauth_token (last_used_at DESC NULLS LAST);
