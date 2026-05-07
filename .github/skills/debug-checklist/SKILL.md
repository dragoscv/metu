---
name: debug-checklist
description: Systematic checklist for debugging issues in metu — auth, RSC, Inngest, hub, Drizzle, AI SDK. Use when something is "not working" and you need to triage before changing code.
---

# Debug checklist

Use this when a feature isn't behaving and you need to localize the bug
before touching code. Follow it top-to-bottom — early steps are cheaper.

## 0. Reproduce

- Exact URL / action.
- Exact error message (browser console + server terminal output).
- Did it ever work? When? `git log --oneline -- <relevant-path>`.

## 1. Auth & session

- Is the user signed in? `await auth()` returns a session?
- Does the session have a `workspaceId`? (`workspaceMember` row exists?)
- For SDK routes: bearer token valid? Recompute `sha256(token)` and grep
  `oauthToken.tokenHash` in the DB.
- Required scope present in the token? See `KNOWN_SCOPES`.

## 2. Workspace scoping

The #1 metu bug class. Re-read every `where(...)` clause in the failing
path and confirm `workspaceId` is filtered. A query that returns "no rows"
or "wrong rows" is almost always this.

## 3. Server vs client component

- Is the failing component `'use client'` when it shouldn't be? RSC errors
  often manifest as "X is not a function" or hydration mismatches.
- Are you `await`-ing `searchParams` / `params`? They are Promises in Next 16.
- Is a Server Action being called from a non-form path? Make sure it's
  `'use server'` and called from a client boundary.

## 4. Drizzle 0.36

- `.returning({...})` projection? **It breaks typing** — use no-arg
  `.returning()` and read the full row.
- Relational query with implicit `with`? **Doesn't exist** — declare
  `with: { ... }` explicitly.
- Pgvector / pg_trgm — confirm the extension is installed
  (`CREATE EXTENSION IF NOT EXISTS vector;` in
  `infra/docker/postgres-init.sql`).

## 5. Migrations

- Did you apply the migration locally? `pnpm db:push`.
- Migration runner reads `.env.local`. Is `DATABASE_URL` set there?
- Migrations 0001–0003 are NOT idempotent. If `migrate` against an
  existing DB fails, use `db:push`.

## 6. Inngest

- Is the function registered in `apps/web/src/inngest/route.ts`?
- Open the dev server (<http://localhost:8288>) — is the run there?
- Did a side effect happen outside `step.run`? Retries will duplicate it.
- Cron not firing? Cron strings are UTC. Inngest dev server respects them.
- `waitForEvent` not resuming? Check `match` filter; use a literal not
  template-string interpolation if the value comes from `event.data`.

## 7. AI SDK v5

- `stopWhen` is `stepCountIs(n)` from `'ai'`, NOT a custom callback.
- `tool({ inputSchema })` works with Zod v4 `z.object`. If your tool
  schema uses Zod v3 syntax, that's a bug.
- Streaming chat? Returning `result.toTextStreamResponse()`?
- `recall()` from `@metu/core/memory` — read it as
  `(result as { rows? }).rows ?? result`.

## 8. Hub / realtime

- `HUB_URL` and `HUB_INTERNAL_SECRET` set in `.env.local`? If unset,
  `hubBroadcast` is a no-op (by design — local dev without hub is fine).
- Companion paired? Check `/devices` — `presence='online'`?
- Internal callback failing 401? Header is `x-hub-secret` (lowercase) and
  compared timing-safe.
- Device not receiving pushes? Check the WS frame in the hub logs and the
  `kinds` filter on `hubBroadcast`.

## 9. OAuth provider

- Authorize loop? `redirect_uri` exact match against `oauthClient` row.
- Token exchange 400? PKCE `code_verifier` mismatch is the #1 cause.
- Refresh returning `invalid_grant`? Replay → family revoked. Check
  `oauthToken.revokedAt` for the family.

## 10. Tauri capabilities

- Plugin call refused? Add the specific permission to a capability JSON
  (`apps/companion/src-tauri/capabilities/`). Never `core:default`.

## 11. Lint / typecheck

If the app runs but `pnpm typecheck` fails:

- TS project references are stale: `pnpm -w turbo run typecheck --force`.
- `noUncheckedIndexedAccess` is NOT enabled (yet) — a `T[number]` access
  isn't `T | undefined` in this repo.

## 12. Last resort

- Clear `.next` + `.turbo`: `Remove-Item -Recurse -Force apps/web/.next, apps/web/.turbo`.
- Reset infra: `pnpm infra:reset` then `pnpm infra:up` then `pnpm db:push`.
- Re-read `/memories/repo/metu-master-decisions.md` — the bug is often a
  documented gotcha from a prior slice.

## Anti-patterns when debugging

- ❌ Adding `try / catch` to "make the error go away."
- ❌ Adding a `console.log` you'll forget to remove.
- ❌ Bumping a dependency to fix a behavior you don't understand.
- ❌ Disabling a check (lint rule, scope check, ACL) to unblock yourself.
