---
applyTo: 'apps/web/**/*.{ts,tsx}'
description: Next.js 16 App Router conventions for apps/web — RSC, Server Actions, proxy.ts, caching.
---

# Next.js 16 (apps/web) conventions

## Server-first

- Default to **React Server Components**. Only mark a file `'use client'` when
  it actually needs browser APIs, hooks, or event handlers.
- Mutations are **Server Actions**, not API routes. API routes (`route.ts`)
  are reserved for: webhooks, OAuth endpoints, bearer-token SDK
  (`/api/sdk/v1/*`), and internal hub callbacks (`/api/internal/*`).
- A Server Action MUST:
  1. Open with `'use server'`.
  2. Call `auth()` (or `getServerSession()`) and bail if the session is missing.
  3. Resolve `workspaceId` and verify membership.
  4. Validate every input with a Zod schema (`@metu/types` or local).
  5. End with `revalidatePath(...)` / `revalidateTag(...)` / `redirect(...)`
     when state visible in UI changed.

## Routing

- App Router only (`apps/web/src/app`). Authenticated pages live under the
  `(app)` route group; layout `(app)/layout.tsx` mounts `SidebarProvider`,
  `MobileTopbar`, `PageTransition`, providers.
- The sign-in page is at `/sign-in`. Public OAuth pages live at
  `/authorize`, `/devices/verify`, `/devices`.
- Embed-style pages (no sidebar) live under `app/embed/*`.

## Route protection — `proxy.ts`, NOT middleware

- `apps/web/src/proxy.ts` exports a `proxy` function. **`middleware.ts` is
  removed in Next 16; do not recreate it.**
- The proxy redirects unauthenticated users to `/sign-in`. The allowlist
  bypasses cookie-auth for: `/api/auth/*`, `/api/oauth/*`, `/.well-known/*`,
  `/api/internal/*`, `/api/sdk/v1/*`, `/api/inngest`, `/api/push/*`.
- When you add a new public-bearer or webhook route, add it to the proxy
  allowlist or it will redirect-loop signed-out callers.

## Caching

- Pages are dynamic by default. To cache a slow piece, wrap a server function
  in `'use cache'` (function-level Cache Components directive) and tag it with
  `cacheTag(...)` so you can `revalidateTag('that-tag')` from a Server Action.
- `cacheComponents: true` is **NOT** yet enabled in `next.config.ts`. Don't
  rely on it; treat caching as opt-in via the directive only.
- Use `unstable_cache` only for legacy code; prefer `'use cache'` for new work.

## Data access

- Drizzle queries go through `getDb()` from `@metu/db`. Always include
  `workspaceId` in the `where` clause. See
  [drizzle-db.instructions.md](./drizzle-db.instructions.md).
- Never fetch from a third-party API in render — use a Server Action or an
  Inngest function and cache the result in our DB.

## Forms

- Simple form (one field, one button): use `useActionState(action, init)`,
  return `{ ok, errors? }` from the action, render errors inline.
- Complex form (multi-step, conditional, schema-driven): `react-hook-form`
  - `@hookform/resolvers/zod` calling the same Server Action on submit.
- Always show optimistic state with `useTransition` + `sonner` toasts.

## URL state

- Use **`nuqs`** for filters, tabs, sort, search, pagination cursors. The
  `NuqsAdapter` is mounted in the root provider.
- Read `searchParams` server-side (it's a Promise in Next 16) and pass values
  into a small client toolbar that owns the nuqs hook.
- Forbidden: `useState` for shareable state, `router.push('?...')` strings,
  reading `window.location.search`.

## Error handling

- Each route group has `error.tsx` + `loading.tsx`. The `(app)` group renders
  a `Card`-based error fallback; `app/global-error.tsx` is the root fatal
  fallback (inline-styled, no providers).
- Never throw to the user. Catch in the action, return `{ ok: false, error }`,
  render via `sonner.toast.error(...)`.

## Env / config

- Public env vars must be prefixed `NEXT_PUBLIC_`. Server-only vars are
  validated at module load (or at first use). Never reach for `process.env`
  inside an RSC without a fallback.
- Add new env vars to `.env.example` AND `scripts/bootstrap-env.mjs`.

## next.config.ts

Locked-in flags (do not remove without discussion):

```ts
{
  reactCompiler: true,
  experimental: { turbopackFileSystemCacheForDev: true },
}
```

Cache Components (`cacheComponents: true`) is intentionally NOT enabled yet.

## Page layout & components

The page-layout contract (Page / PageHeader / PageSection, nuqs, sidebar nav)
is enforced by [page-layout.instructions.md](./page-layout.instructions.md).
**Read it before adding any route under `(app)/`.**
