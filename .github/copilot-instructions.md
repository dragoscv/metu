# metu — AI agent onboarding

> "After 3 days, 3 weeks, or 3 months — metu knows where I left off, why, and the
> next minimum-viable step." Every change must serve that north star.

This file is the single entry point for any AI coding agent (Copilot, Claude
Code, Cursor, etc.) working in this repo. **Read it before editing anything.**
Domain-specific rules live in [`.github/instructions/`](./instructions/) and
multi-step recipes live in [`.github/skills/`](./skills/). Background context
is in [`docs/`](../docs/).

## What metu is

metu is a Personal AI Operating System: a central console that observes the
user across surfaces (web, mobile, VS Code, browser, Tauri companion, MCP) and
runs a continuous **Conductor** agent that plans, asks for permission, calls
tools, and notifies devices. Other apps (notai, mmo, …) are clients that
authenticate via OAuth2 and exchange events through the hub.

## Repo shape

pnpm workspace + Turborepo, Node ≥ 22, pnpm ≥ 9. **Always** use `pnpm` (never
`npm`/`yarn`) and the root `pnpm-workspace.yaml` `catalog:` for shared deps.

```
apps/
  web/         Next.js 16 (App Router, RSC, Server Actions, proxy.ts) — port 24890
  worker/      Cloud Run HTTP worker (transcription + heavy jobs)
  hub/         Hono + ws realtime gateway (devices + apps) — port 24891
  mobile/      Expo Router (iOS + Android)
  companion/   Tauri 2 desktop shell (Rust + React 19)
  vscode-ext/  VS Code extension (Copilot bridge)
  browser-ext/ Chrome MV3 extension
  mcp-server/  MCP tools over stdio/HTTP
packages/
  ai/          BYOK provider mesh, planner, crypto (Sealed)
  auth/        Auth.js v5 config + OAuth helpers
  config/      Shared tsconfig + eslint base
  core/        Agent (tools/policy/planner), memory, project, focus, goals, continuity
  db/          Drizzle 0.36 schema + queries + migrations
  integrations/ GCS, GitHub, Google, Telegram, Stripe, MCP-client
  protocol/    Zod event/message schemas shared across services
  sdk/         Typed client for external apps + companion
  types/       Shared zod schemas (cross-package contracts)
  ui/          Tailwind v4 + shadcn-style primitives + theme tokens
```

## Golden stack (must use)

- **Framework**: Next.js 16 (App Router, RSC, Server Actions, Turbopack default).
  Use `proxy.ts` (not `middleware.ts`) for route protection.
- **React**: 19.2+, React Compiler enabled.
- **TypeScript**: 5.9+ strict.
- **ORM**: Drizzle 0.36 (see [drizzle-db.instructions.md](./instructions/drizzle-db.instructions.md) for gotchas).
- **DB**: Postgres (Neon prod, local docker-compose dev) + pgvector + pg_trgm.
- **Auth**: Auth.js v5 (`packages/auth`) + OAuth2/OIDC provider in `apps/web`.
- **Validation**: Zod v4 everywhere — at every system boundary.
- **AI SDK**: Vercel AI SDK v5 (`ai`, `@ai-sdk/anthropic`, etc.). Use `stepCountIs(n)` from `'ai'` for `stopWhen`.
- **Workflows**: Inngest (`apps/web/src/inngest`, mounted at `/api/inngest`).
- **CSS**: Tailwind v4 (CSS-first `@theme`, no `tailwind.config.js`). Theme tokens in `packages/ui/src/styles.css`.
- **UI**: `packages/ui` primitives (`Page`, `PageHeader`, `PageSection`, `Card`, `Badge`, `StatusDot`, `Button`, …). Never hand-roll.
- **Forms**: simple → `useActionState` + Server Action; complex → `react-hook-form` + zod.
- **URL state**: `nuqs` (NuqsAdapter mounted at root). Never `useState` for filters/tabs/pagination.
- **Toasts**: `sonner`.
- **Animations**: `framer-motion` (durations 160–280ms, ease `[0.22,1,0.36,1]`).

## Architectural invariants

1. **Workspace scoping**: every domain row has `workspace_id`. Every query and
   server action MUST filter by it. Cross-tenant leaks are the #1 bug class.
2. **ACL is policy**: agent tools never run unguarded — always go through
   `runTool()` in [`packages/core/src/agent/policy.ts`](../packages/core/src/agent/policy.ts).
   Per-workspace + per-tool + per-integration overrides exist. Modes: `observe`,
   `ask`, `auto-with-undo`, `autopilot`.
3. **BYOK + Sealed secrets**: third-party tokens are AES-256-GCM-sealed via
   `@metu/ai/crypto`. Never store plaintext credentials.
4. **Audit everything**: side-effecting tools write a `tool_call` row + a
   `timeline_event`. Mutating SDK routes emit `conductor/observe`.
5. **Hub is the only realtime path**: web → device pushes go through
   `hubBroadcast({workspaceId, envelope})`. Devices → web go through
   `apps/hub` which forwards to `/api/internal/hub/*` with `x-hub-secret`.
6. **Server-first**: prefer RSC + Server Actions. `'use client'` only when
   a hook/event handler needs it. API routes are for webhooks + bearer SDK only.
7. **Default dynamic, opt-in cached** with `'use cache'` (Cache Components is
   not yet enabled — see follow-ups).
8. **Single source of truth for sharable state is the URL** (nuqs).
9. **One `<h1>` per page**. Use `PageHeader`. Never hand-roll headers.

## Critical gotchas (will bite you)

- **Drizzle 0.36**: `.returning({...projection})` typing breaks. Use `.returning()`
  no-arg and read full row.
- **AI SDK v5**: `tool({inputSchema})` works with Zod v4 `z.object` schemas.
  Use `stepCountIs(n)` for `stopWhen` — **not** a custom callback.
- **`recall()`** from `@metu/core/memory` returns a QueryResult-ish: access
  `(result as { rows? }).rows ?? result`.
- **No `@ai-sdk/react`**: chat UI uses plain `fetch` + `ReadableStream` reader
  against `result.toTextStreamResponse()`.
- **Migrations**: `0001`–`0003` are not idempotent. Use `drizzle-kit push` for
  local dev; the journal will re-attempt them otherwise. Make any new migration
  idempotent (`DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$;`).
- **`proxy.ts` allowlists**: `/api/internal/*`, `/api/sdk/v1/*`, OAuth routes
  bypass cookie auth. Don't add new public-bearer routes without updating the proxy.
- **Hub `x-forwarded-for`** is only trustworthy behind the GCP LB. Locally, IP
  parsing in `apps/hub/src/limits.ts` is approximate.

## Verification before declaring "done"

After any non-trivial change, run from the repo root:

```pwsh
pnpm typecheck     # turbo run typecheck — must be N/N green
pnpm lint          # apps/web at minimum; expand as packages add lint scripts
```

For DB schema changes also run `pnpm db:generate` (commit the SQL) and
`pnpm db:push` against the local Postgres. For UI changes, verify via the
already-running dev server (`http://localhost:24890`) — Playwright is available.

## When in doubt

- Check `/memories/repo/metu-master-decisions.md` (written by previous agents) —
  it captures **every shipped slice** and the gotchas each one introduced. Treat
  it as the authoritative changelog of intent.
- Read the relevant `.github/instructions/*.instructions.md` file before editing.
- Read the relevant `docs/*.md` for "why".
- Don't add features that weren't asked for. Vertical slices only.

## How to ship

- Branches: `feat/short-slug`, `fix/short-slug`. Conventional Commits enforced
  by commitlint (scopes match package/app names: `web`, `hub`, `worker`,
  `companion`, `db`, `core`, `ai`, `ui`, `protocol`, `sdk`, `auth`, `mobile`, …).
- Husky pre-commit runs lint-staged + `turbo run lint typecheck`.
- One concern per PR. Keep diffs < 400 lines when possible.
