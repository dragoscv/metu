# metu — Security

This is the threat-model and control list for the platform. We deliberately
keep the surface small.

## Trust boundaries

```
   user (browser/mobile)
        │  HTTPS, Auth.js session cookie (httpOnly, Secure, SameSite=Lax)
        ▼
   ┌────────────────────────────┐    Server Actions / Route Handlers
   │  apps/web (Vercel, Node)   │ ── Bearer (signed) ──► Cloud Run worker
   └─────┬──────────────────────┘                          │
         │ Drizzle (TLS)                                   │
         ▼                                                 ▼
   Neon Postgres                                  GCS uploads, Speech API
```

## Authentication

- **Auth.js v5** with Google as the only IdP in V1. Sessions are _database_-backed (rotatable, revocable).
- Cookies: `httpOnly`, `Secure`, `SameSite=Lax`. CSRF tokens for any form not using Server Actions; Server Actions are CSRF-safe by design (origin + signed payload).
- Mobile/browser-ext/VS Code clients use **personal API tokens** issued from `/settings`. Tokens are hashed (Argon2) at rest; only a 4-char prefix is shown for identification.

## Authorization

- Every server action and route handler calls `auth()` first; unauthenticated requests are rejected before any DB read.
- Multi-tenant isolation: every query filters on `workspaceId`. The `session.user.workspaceId` is set by the Auth.js `signIn` event and copied into the JWT/session — it is **not** taken from the request body.
- The `workspaceMember` table uses `role ∈ {owner, admin, member, viewer}`; mutations check the role server-side.

## Encryption

- **At rest**:
  - Postgres column-level encryption for BYOK keys: AES-256-GCM with 12-byte IV, 16-byte tag, key from env (V1) or KMS (V2).
  - GCS bucket uses Google-managed encryption (CMEK upgrade path documented in `infra/terraform`).
- **In transit**: TLS 1.3 everywhere. HSTS header on the web app (set via `next.config.ts`).
- **Master key rotation**: the `keyRef` column on `providerCredential` allows multiple keys to coexist; rotate by re-encrypting in a background job, then dropping the old key.

## Headers

The web app sets:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: microphone=(self), camera=()
Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; ...
```

## Inputs

- **Server Actions** validate every input with Zod at the top of the function before any side effect.
- **Webhooks** verify signatures _before_ parsing the JSON body:
  - GitHub: HMAC-SHA256 of the raw body with `GITHUB_WEBHOOK_SECRET`.
  - Stripe: `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET`.
  - Telegram: secret-in-URL (Telegram doesn't sign).
- **File uploads** go to GCS via signed URLs scoped to a single `Content-Type` and a 5-minute TTL; the web app never proxies user bytes.

## Rate limiting

Upstash Redis is used for:

- Server Action `recallAction`: 30/min/user
- Brain-dump capture: 60/min/user
- BYOK upsert: 10/min/user
- Webhook receivers: 100/min/IP

## Secrets

- Local: `.env.local`, gitignored.
- CI/CD: GitHub Encrypted Secrets + Workload Identity Federation (no static GCP keys in GitHub).
- Production runtime: Vercel envs (encrypted at rest) for web; Secret Manager for worker.
- The `MASTER_ENCRYPTION_KEY` is the most sensitive secret; in V2 it's replaced by a Cloud KMS DEK.

## Logging

- We log **structured** events with `pino`; never include API keys, tokens, raw prompts of sensitive intents, or full message bodies.
- PII (email) is logged at debug level only. Production runs at `info`.
- Error stacks are sent to Vercel logs; we do not yet ship to a third-party APM (it's on the V2 list).

## Data deletion

- Deleting a workspace cascades through `ON DELETE CASCADE` to: members, captures, projects, tasks, decisions, integrations, provider credentials, agent runs, focus state, energy logs, timeline events, memory chunks.
- Captures uploaded to GCS are removed via a lifecycle rule keyed off the `tmp/` prefix; persistent objects are deleted on the application layer with `gcs.delete(storageKey)` (TODO: schedule).
- Right to export: `GET /api/workspace/export` (TODO V2) emits a single JSON archive.

## OWASP Top 10 mapping

| OWASP                     | Control                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| Broken access control     | Workspace filter on every query, role checks server-side              |
| Cryptographic failures    | AES-256-GCM, TLS 1.3, KMS migration path, no plaintext key storage    |
| Injection                 | Drizzle parameterized queries, Zod input validation, no string SQL    |
| Insecure design           | Server Actions over REST, allowlist of public routes in `proxy.ts`    |
| Security misconfiguration | Strict CSP/HSTS, public-access-prevention on GCS, IAM least-privilege |
| Vulnerable components     | Renovate (TODO) + `pnpm audit` in CI                                  |
| Identification failures   | Auth.js + Google OIDC, hashed PATs, session DB invalidation           |
| Software/data integrity   | Signed Vercel deploys, WIF for Cloud Run, signed webhooks             |
| Logging failures          | Structured logs, no secrets, audit trail in `agentRun`                |
| SSRF                      | No user-controlled URL fetching except signed GCS reads               |

## Reporting

Security issues → `security@metu.ro`. We do not yet run a formal bug bounty.
