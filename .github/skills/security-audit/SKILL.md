---
name: security-audit
description: Run a security + reliability audit pass on metu, prioritize findings, and ship the fixable ones. Use when the user asks "audit", "harden", "find problems", "review for security", or after a bigger feature lands.
---

# Security & reliability audit

This skill replays the methodology that produced Slice 14c (production
hardening). Use it for a pre-release sweep, after a multi-slice push, or
when the user explicitly asks for an audit.

## Phase 1 — Inventory (read-only)

Open these files and skim with the
[security.instructions.md](../../instructions/security.instructions.md)
checklist in your head:

- `apps/web/src/proxy.ts` — allowlist drift (new public routes?)
- `apps/web/src/lib/bearer.ts` — secret compares timing-safe?
- `apps/web/src/lib/safe-equal.ts` — SSRF guards reaching all callers?
- `apps/hub/src/{index,internal,limits,safe-equal}.ts` — handshake budget,
  internal secret compare, IP source.
- `packages/auth/src/oauth.ts` + `apps/web/src/lib/oauth-provider.ts` —
  scope validation, refresh rotation, family revocation.
- `packages/core/src/agent/{policy,tools}.ts` — ACL precedence, recursion
  guard, audit row coverage.
- All Server Actions under `apps/web/src/app/actions/` — `auth()` first?
  Zod-validated? Workspace-scoped?
- All `/api/sdk/v1/*` routes — `resolveSession` + `hasScope` + observe?
- All webhook routes — signature verified with `safeEqual`?
- All migrations under `packages/db/drizzle/` — idempotent guards?
- `apps/worker/src/index.ts` — token length, timing-safe compare.
- `next.config.ts` — security headers, CSP.
- `.env.example` + `scripts/bootstrap-env.mjs` — drift between actual
  required env vars and the bootstrap.

Take notes; do not fix yet.

## Phase 2 — Score & prioritize

For each finding, tag **severity** × **effort**:

| Severity | Means                                                  |
| -------- | ------------------------------------------------------ |
| `crit`   | Tenant leak, secret leak, RCE-equivalent, auth bypass. |
| `high`   | DoS path, missing audit on side effect, SSRF.          |
| `med`    | Defensive gap; unlikely-exploit hardening.             |
| `low`    | Style / nit / future-proofing.                         |

| Effort | Means                                  |
| ------ | -------------------------------------- |
| `S`    | < 1 hour, single file.                 |
| `M`    | A few files; obvious change.           |
| `L`    | New abstraction or migration required. |

Rank `crit-S` and `high-S` first. Defer `low-L` to follow-ups.

## Phase 3 — Fix the high-yield items

Common fix templates the audit re-applies:

- Replace `===` on a secret → `safeEqual(...)`.
- Add `assertSafeOutboundUrl(url)` before `fetch(userUrl)`.
- Add `auth()` + `workspaceId` filter to a Server Action that lacked it.
- Wrap a side effect in `step.run` inside an Inngest function.
- Add concurrency to a fan-out event handler.
- Add a `notify()` on the silent-failure path.
- Make a migration idempotent.
- Add the missing route to `proxy.ts` allowlist.

When making changes:

- One concern per commit.
- Don't refactor adjacent code "while you're there."
- Keep the diff as small as the fix permits.

## Phase 4 — Verify

```pwsh
pnpm typecheck
pnpm lint
```

Both green before declaring done.

If the change touched the OAuth path, manually verify:

- Sign-in still works.
- A registered OAuth client can still authorize + token + refresh.
- A bearer SDK route returns 401 for missing token, 403 for wrong scope.

If the change touched the hub, manually verify:

- Companion still pairs and stays connected.
- A notification from web reaches the device.

## Phase 5 — Record

Append an audit entry to `/memories/repo/metu-master-decisions.md`:

```md
## Audit pass (<YYYY-MM-DD>) — <focus>

Read-only audit found ~<N> findings. Fixed in this pass:

- <bullet per fix, file path mentioned>

Deferred to follow-up:

- <bullet per deferred item, with reason>
```

Also update the "Outstanding gotchas" / "Known follow-ups" section at the
bottom of that file so the next agent sees them.

## Anti-patterns when auditing

- ❌ Adding speculative guards "in case." Only fix observed risks.
- ❌ Rewriting modules instead of patching. The point is to ship hardening
  fast; large rewrites are their own slice.
- ❌ Disabling code paths because they look risky — confirm the risk first.
- ❌ Skipping the verification step. An audit that breaks the build is a
  net loss.
