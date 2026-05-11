---
applyTo: '**'
description: Repo-wide security rules — Zod boundaries, SSRF, timing-safe compares, secrets, scopes.
---

# Security rules (apply to all code)

These are non-negotiable. Code review treats violations as blockers.

## Validate at every boundary

Every system boundary parses through Zod v4:

- HTTP request bodies (Server Actions, route handlers).
- WebSocket envelopes (use `@metu/protocol` schemas).
- Inngest event payloads (the `Events` map is the schema).
- External API responses you can't fully trust.

Internal function calls between our packages do NOT need re-validation.

## Workspace scoping

Every domain query MUST filter by `workspaceId`. This is the #1 multi-tenant
bug class. See [drizzle-db.instructions.md](./drizzle-db.instructions.md).

## Authentication & authorization

- Server Actions: call `auth()` and resolve workspace membership before
  doing anything.
- SDK routes: `resolveSession(req)` + `hasScope(session, '<scope>')`.
- Hub callbacks: `safeEqual(secret, env.HUB_INTERNAL_SECRET)`.
- See [auth-and-oauth.instructions.md](./auth-and-oauth.instructions.md).

## Timing-safe secret compares

**Never** compare a secret with `===` or `==`. Always use `safeEqual` from:

- `apps/web/src/lib/safe-equal.ts` (web, server actions, route handlers).
- `apps/hub/src/safe-equal.ts` (hub).

This applies to: `HUB_INTERNAL_SECRET`, `WORKER_AUTH_TOKEN`, dev tokens,
Telegram webhook secret, any future shared secret.

## SSRF guard on outbound URLs

Any feature that fetches a user-supplied URL MUST first call
`assertSafeOutboundUrl(url)` from `apps/web/src/lib/safe-equal.ts`.

It rejects:

- Loopback (127.0.0.0/8, ::1).
- RFC1918 private ranges (10/8, 172.16/12, 192.168/16).
- Link-local (169.254/16) — including GCP/AWS metadata `169.254.169.254`.
- IPv6 ULA (fc00::/7) and link-local (fe80::/10).

In `NODE_ENV=production` it also requires `https:`.

Currently applied: `connectExternalMcpAction`, `registerAppAction` (webhook
URL). Apply it to any new outbound URL feature.

## Secrets at rest

- BYOK / third-party tokens: AES-256-GCM-sealed via `@metu/ai/crypto`.
  Persist the `Sealed { ciphertext, iv, tag }` shape, open lazily per use.
- `ENCRYPTION_KEY` is base64-validated at module load. Never inline a
  fallback or check `if (!key) return null`.
- OAuth tokens: stored as `sha256(token)`. Plain `metu_at_*`/`metu_rt_*`
  are returned ONCE and never logged.
- Webhook secret: stored as `sha256(secret)` on `oauthClient.webhookSecretHash`.
  Plaintext is returned ONCE on creation (UI shows a copy-once banner) and
  never persisted. HMAC verification on inbound webhooks uses the hash.

## Refresh-token rotation

Replaying a consumed refresh token triggers `revokeTokenFamily()` which
revokes the entire family. Don't disable this. If you add a new flow that
creates refresh tokens, set `parentTokenId` so the family graph stays whole.

## Rate limiting

`apps/web/src/lib/ratelimit.ts` wraps Upstash Ratelimit. Already on
`/api/oauth/token` and `/api/oauth/device`. Hub WS handshake has its own
in-memory budget (`apps/hub/src/limits.ts`).

Any new auth-touching endpoint or expensive operation needs a limiter.

## Logging

- Never log: access tokens, refresh tokens, sealed `iv+tag` pairs, OAuth
  client secrets, ENCRYPTION_KEY, raw user PII more than necessary.
- Use the structured `log` from `@metu/logger` (auto-redacts a known set
  of secret keys + scrubs JWT/`metu_at_*`/`metu_rt_*` shapes from any
  string). `installConsoleRedactor()` is wired in `instrumentation.ts`
  so even bare `console.*` calls get scrubbed.
- Sentry: `@sentry/nextjs` is installed and wired via
  `instrumentation.ts` + `instrumentation-client.ts`. Activates only
  when `SENTRY_DSN` (server) / `NEXT_PUBLIC_SENTRY_DSN` (browser) is
  set; safe no-op otherwise.
- Pino is intentionally NOT used — the custom logger emits the same
  structured JSON shape Cloud Logging needs and avoids an extra dep.

## Headers / CSP

- `next.config.ts` sets baseline security headers. When you add a new
  domain (e.g. a third-party CDN), update the CSP — don't `unsafe-inline`
  to dodge it.

## OWASP Top 10 quick checklist

When reviewing your own change, ask:

- [ ] Workspace scoping on every query?
- [ ] Zod-validated inputs?
- [ ] Auth + scope check on the route/action?
- [ ] Timing-safe secret comparison?
- [ ] SSRF guard on user-supplied URLs?
- [ ] Sealed third-party tokens?
- [ ] No secrets in logs / errors / responses?
- [ ] Rate-limited endpoint?
- [ ] No new dependency with known CVEs?
