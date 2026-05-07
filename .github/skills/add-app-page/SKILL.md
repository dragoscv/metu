---
name: add-app-page
description: Add a new authenticated route under apps/web/src/app/(app)/ following metu's page layout, nav, and URL state conventions. Use when the user wants a new page, dashboard, list view, detail view, or settings tab.
---

# Add an `(app)` page

This is the short, executable version of
[`page-layout.instructions.md`](../instructions/page-layout.instructions.md)

- [`ui-styling.instructions.md`](../instructions/ui-styling.instructions.md).
  Read those for the why; follow this for the what.

## 1. File location

Authenticated pages live at
`apps/web/src/app/(app)/<segment>/page.tsx`.

- The `(app)` route group provides the sidebar, mobile topbar, error /
  loading boundaries, providers, and `PageTransition`.
- Public pages (sign-in, OAuth consent, embed, devices/verify) live
  outside `(app)`.

## 2. Page skeleton

```tsx
// apps/web/src/app/(app)/things/page.tsx
import { Page, PageHeader, PageSection, Badge } from '@metu/ui';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { ThingsToolbar } from '@/components/things/things-toolbar';
import { ThingsList } from '@/components/things/things-list';
import { listThings } from '@/lib/things';

export default async function ThingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/sign-in');

  const params = await searchParams;
  const things = await listThings({
    workspaceId: session.workspaceId,
    status: params.status,
    q: params.q,
  });

  return (
    <Page>
      <PageHeader
        title="Things"
        description="Short, plain-language explanation of what lives here."
        actions={
          <Badge variant="neutral" size="sm">
            {things.length} total
          </Badge>
        }
      />

      <ThingsToolbar />

      <PageSection title="Active">
        <ThingsList items={things} />
      </PageSection>
    </Page>
  );
}
```

Hard rules:

- **One `<h1>`** — `PageHeader` provides it. Don't render another.
- **No `<header>` / hand-rolled title divs** — use `PageHeader`.
- **No `space-y-6` wrapper div** — `<Page>` handles it.
- **No per-page entrance `motion.div`** — `PageTransition` is mounted in
  the group layout.

## 3. Detail / sub-pages — render `back`

```tsx
<PageHeader size="sm" back={{ href: `/things`, label: 'All things' }} title={thing.title} />
```

`BackLink` (used internally) prefers `router.back()` when same-origin
in-app history is available; otherwise it uses `href`.

## 4. URL state (filters/tabs/sort/pagination/search)

Build a small `<things-toolbar.tsx>` client component that owns the nuqs
hooks. The server component reads `searchParams` and passes data down;
the client component drives changes back up via the URL.

```tsx
'use client';
import { useQueryStates, parseAsString } from 'nuqs';

export function ThingsToolbar() {
  const [{ status, q }, setQueryStates] = useQueryStates(
    {
      status: parseAsString.withDefault(''),
      q: parseAsString.withDefault(''),
    },
    { shallow: false },
  );
  // ... inputs that call setQueryStates({...})
}
```

`shallow: false` so the server component re-renders with the new params.

## 5. Forms

- Simple form: `useActionState` + Server Action, return `{ ok, errors? }`.
- Complex form: `react-hook-form` + `@hookform/resolvers/zod` + same Server
  Action on submit.
- Server Action lives in `apps/web/src/app/actions/<feature>.ts`. It MUST:
  call `auth()`, validate with Zod, scope by `workspaceId`, call
  `revalidatePath(...)`.

## 6. Sidebar nav

If this is a primary destination, add it to
`apps/web/src/components/sidebar/nav-config.ts` (NAV array). Detail/sub
routes are NOT in nav.

If it's reachable via Cmd+K, add it to `command-bar.tsx`.

## 7. Verify

1. Navigate to the page. Sidebar entry highlights correctly (group panel
   slides if it's a child).
2. Filter / sort / search update the URL. Reload preserves them.
3. Back link works from a child page.
4. `pnpm typecheck` and `pnpm lint` pass.
5. Visual: respects all 4 themes (`glass | minimal | dense | soft`).

## Forbidden patterns (will fail review)

- ❌ Raw `<div className="space-y-6">` or `<header><h1>...</h1></header>`.
- ❌ `useState` for filters/tabs/pagination.
- ❌ `router.push('?foo=bar')` strings.
- ❌ Hardcoded Tailwind palette colors instead of `<Badge>`/`<StatusDot>`
  or `--color-{state}-*` tokens.
- ❌ Wrapping the page in `motion.div` for entrance animation.
- ❌ A Server Action without `auth()` + workspace check + Zod validate.
