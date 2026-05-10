# Cache Components — adoption plan

> **Status:** Not yet enabled. This is a deliberate spike that captures
> what we know, what would change, and the smallest path to flipping
> one page first. Do **not** turn `experimental.cacheComponents` on
> globally without working through this checklist.

## What Cache Components is

Next.js 16 `experimental.cacheComponents` (formerly "PPR — Partial
Prerendering" + the `'use cache'` directive) inverts the default
caching model:

| Mode                 | Default                                                               | Opt-in                                    |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| **Today (us)**       | Every page is dynamic. Add `'use cache'` to opt into caching.         | `unstable_cache`, `'use cache'` per call  |
| **Cache Components** | Every fetch / prop boundary is _cached_ unless you mark it `dynamic`. | `<Suspense>` wrapping the dynamic islands |

The promise: a single page can have a fully static shell + streamed
dynamic islands without you maintaining two render trees.

## Why we haven't flipped it yet

1. **Most pages are tenant-personal**. The shell of `/timeline` is the
   sidebar + filters — already memoizable — but the body is per-user
   per-workspace and changes on every capture. Caching it without per-
   workspace key derivation would leak data across tenants.
2. **`auth()` is dynamic-by-design**. Every Server Component that calls
   `auth()` is dynamic, full stop. Wrapping that page's shell in
   `'use cache'` requires hoisting the `auth()` call out of the static
   subtree and threading the user shape through props — a real refactor.
3. **Inngest + Server Actions ignore the cache**. Mutations already
   invalidate via `revalidatePath`, so the win is on cold reads only.
4. **We have ~50 pages**. Flipping the default forces an audit of every
   one. The risk/reward is bad until we're past beta.

## The shape of a "good first page" to flip

Pick a page where:

- The render tree is mostly **derived from URL state, not session**.
- The dynamic data is naturally Suspense-bounded (one query, one chart).
- The cache key can be a tuple of `(workspaceId, ...searchParams)`.
- The page is **read-heavy**: visited often, mutated rarely.

Best candidates today:

- `/settings/profile` — reads `user` row, almost never mutated. Owner
  of the page is always the logged-in user.
- `/projects/[id]` shell — project metadata changes at human pace.
  Tasks list and captures stay dynamic.
- `/audit` — list view; row count + pagination are nuqs-driven.

Worst candidates:

- `/timeline` — every capture creates a row.
- `/conductor/*` — every tick is a mutation.
- `/` (dashboard) — too many sources of fresh data.

## Concrete spike plan (when we're ready)

1. Land this doc.
2. **Per-page** add `'use cache'` to the Server Component body of one
   of the candidates above. Verify with the React DevTools that the
   server component render is reused on the second navigation.
3. Add `cacheTag(\`workspace:\${workspaceId}\`)`inside the cache scope
so the existing`revalidateTag` path can invalidate after a mutation.
4. Run `pnpm --filter @metu/web exec next build` and confirm:
   - The build report marks the page as `(◐) Partially prerendered`.
   - The shell HTML is in `.next/server/app/...` as a static file.
5. Hammer the page from two different tenant sessions in dev (`pnpm
dev` + Incognito) to confirm the dynamic island is per-tenant.
6. Flip `experimental.cacheComponents: true` only after we have **at
   least 3 pages** running cleanly under the per-page directive — that
   gives us confidence the codebase tolerates the inverted default.

## Cache key recipe

For Cache Components, the implicit key is the function arguments. Make
the cached function take only the values that should distinguish the
cached result:

```ts
async function projectShell(workspaceId: string, projectId: string) {
  'use cache';
  cacheTag(`workspace:${workspaceId}`, `project:${projectId}`);
  const proj = await getProject(workspaceId, projectId);
  return <ProjectShell project={proj} />;
}
```

`auth()` calls go _outside_ the cached function. The page extracts
`workspaceId` from `session.user.workspaceId` and passes it in.

## Invalidation

We already standardized on `revalidatePath('/path')` after mutations.
With Cache Components, prefer `revalidateTag('workspace:${id}')` so a
single mutation invalidates every cached island for that tenant
without us needing to enumerate paths.

The `cacheTag` import comes from `next/cache`.

## When to revisit

- After the Round 6 invite/transfer flows ship and the schema is stable.
- Once we have a Lighthouse profile of the slowest authenticated page.
  If the bottleneck is server render (>200ms p50 of TTFB), Cache
  Components is the lever. If it's hydration cost, this won't help.
