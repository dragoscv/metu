-- Seed the companion's fixed public OAuth client (metu_app_companion).
-- Pairing uses an RFC 8252 loopback-redirect + PKCE flow (no deep link), so we
-- register loopback redirect URIs. The server matches these port-agnostically
-- (scheme + loopback host-class + path), so the runtime ephemeral port is fine.
-- The legacy metu://oauth/callback deep link is kept for backward compat.
-- Idempotent: re-running refreshes redirect_uris + allowed_scopes.
INSERT INTO oauth_client (
  workspace_id,
  client_id,
  client_secret_hash,
  type,
  name,
  redirect_uris,
  allowed_scopes
)
SELECT
  w.id,
  'metu_app_companion',
  NULL,
  'public',
  'METU Companion',
  '["http://127.0.0.1/callback", "http://[::1]/callback", "metu://oauth/callback"]'::jsonb,
  'openid profile email offline_access capture:write recall:read notify:write notify:read event:write event:read tools:invoke audit:read'
FROM workspace w
ORDER BY w.created_at
LIMIT 1
ON CONFLICT (client_id) DO UPDATE SET
  redirect_uris = EXCLUDED.redirect_uris,
  allowed_scopes = EXCLUDED.allowed_scopes,
  updated_at = now();

SELECT client_id, type, redirect_uris, allowed_scopes
FROM oauth_client WHERE client_id = 'metu_app_companion';
