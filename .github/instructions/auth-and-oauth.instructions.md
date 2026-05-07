---
applyTo: 'packages/auth/**,apps/web/src/app/api/oauth/**,apps/web/src/app/api/sdk/**,apps/web/src/app/api/internal/**,apps/web/src/lib/oauth-provider.ts,apps/web/src/lib/bearer.ts,apps/web/src/lib/safe-equal.ts'
description: Auth.js v5 session + OAuth2/OIDC provider + bearer-token SDK + internal hub callbacks.
---

# Auth, OAuth & bearer endpoints

metu plays three auth roles at once. Don't confuse them.

| Role           | How callers authenticate                      | Allowlisted in `proxy.ts` |
| -------------- | --------------------------------------------- | ------------------------- |
| Web user       | Auth.js v5 session cookie                     | No (cookie required)      |
| OAuth provider | `Authorization: Bearer metu_at_*` (DB-backed) | `/api/sdk/v1/*`           |
| Internal hub   | `x-hub-secret: <HUB_INTERNAL_SECRET>` header  | `/api/internal/*`         |

## Auth.js v5 (web sessions)

- Config in `packages/auth/src/`. Drizzle adapter targets `auth.ts` schema
  (`user`, `account`, `session`, `verificationToken`).
- Use `auth()` (the App Router helper) inside Server Actions, RSCs, and
  route handlers to get the current session. **Never** parse cookies manually.
- Workspace selection: `auth()` returns the user; resolve `workspaceId` via
  `workspaceMember` for the active workspace. The first sign-in auto-creates
  a personal workspace.

## OAuth2/OIDC provider (we issue tokens)

- Pure helpers in `packages/auth/src/oauth.ts` (PKCE, hashing, scopes, TTLs).
- DB I/O in `apps/web/src/lib/oauth-provider.ts` (`issueTokens`, `findToken`,
  `consumeRefresh`, `revokeTokenFamily`, `oauthError`).
- Routes: `/.well-known/openid-configuration`, `/authorize` (page +
  `/authorize/decide` POST), `/token` (auth_code | refresh | device_code,
  PKCE required), `/userinfo`, `/revoke`, `/device` (RFC 8628), and the
  user-facing `/devices/verify` page.
- Tokens are stored as `tokenHash = sha256(plaintext)`. Plain `metu_at_*` /
  `metu_rt_*` are returned ONCE and never logged.
- Refresh-token rotation is enforced. Replaying a consumed refresh token
  triggers `revokeTokenFamily` — the whole family dies. Don't disable this.
- Scopes (KNOWN_SCOPES): `openid`, `profile`, `email`, `capture:write`,
  `recall:read`, `notify:read`, `notify:write`, `event:write`,
  `tools:invoke`, `intent:write`, `creds:borrow`. Add a new scope only if
  there's a real need; update OIDC discovery + `KNOWN_SCOPES` together.

## Bearer-token SDK (`/api/sdk/v1/*`)

- Auth via `resolveSession(req)` from `apps/web/src/lib/bearer.ts`. It accepts:
  - Dev token (`METU_DEV_TOKEN` env, **timing-safe** compared via `safeEqual`).
  - OAuth `metu_at_*` access token (recompute sha256 → match `oauthToken`).
- Returns `{ workspaceId, userId, scopes[], clientId, source }`.
- Every route MUST:
  1. `const session = await resolveSession(req); if (!session) return unauthorized();`
  2. `if (!hasScope(session, 'capture:write')) return forbidden();`
  3. Validate body with Zod (schemas live in `@metu/protocol`).
  4. Insert/observe via existing helpers; emit `conductor/observe` for
     mutations so the supervisor sees the side effect.

## Internal hub callbacks (`/api/internal/*`)

- Web ← hub bridge. Authentication is `x-hub-secret` header compared to
  `HUB_INTERNAL_SECRET` via **`safeEqual` (timing-safe)** — never `===`.
- `proxy.ts` allowlists `/api/internal/*` so cookie-auth doesn't run.
- Don't add a public path under `/api/internal/`. Anything that doesn't take
  the hub secret should live under `/api/sdk/v1/*` (bearer) instead.

## Sealed third-party tokens (BYOK)

- Tokens for GitHub, Google, Stripe, Telegram, external MCP, and provider
  credentials are AES-256-GCM-sealed via `@metu/ai/crypto`.
- Persist the `Sealed { ciphertext, iv, tag }` object in the row's `config`
  jsonb (or dedicated columns where present). Open lazily per use.
- The `ENCRYPTION_KEY` env var is base64-validated at module load
  (`packages/ai/src/crypto.ts`). Never inline a fallback.

## Outbound URL safety (SSRF)

- Any feature that fetches a user-supplied URL MUST first call
  `assertSafeOutboundUrl(url)` from `apps/web/src/lib/safe-equal.ts`.
- It rejects loopback / RFC1918 / link-local / IPv6 ULA / GCP metadata
  (`169.254.169.254`). In `NODE_ENV=production` it also requires `https:`.
- Currently applied to `connectExternalMcpAction`. **Apply it** before
  shipping any new outbound integration — webhook URLs in `actions/apps.ts`
  is a known follow-up.

## Rate limiting

- `apps/web/src/lib/ratelimit.ts` wraps Upstash Ratelimit. Already applied
  to `/api/oauth/token` and `/api/oauth/device`. Hub WS handshake has its
  own in-memory budget (`apps/hub/src/limits.ts`).
- New auth-touching endpoint? Add a limiter — don't ship without one.

## Things you should never do

- ❌ Compare a secret with `===` or `String.prototype === ` — always `safeEqual`.
- ❌ Log `metu_at_*` / `metu_rt_*` plaintext, or any sealed ciphertext+iv pair.
- ❌ Issue a token with scopes that weren't in the original consent grant
  (refresh narrows or matches; never widens).
- ❌ Bypass `proxy.ts` allowlist by hand-rolling cookie checks. Use the
  framework helpers or the bearer/internal-secret patterns above.
