---
applyTo: 'apps/web/src/app/**/page.tsx,apps/web/src/components/**/*.tsx'
description: Standardized page layout, navigation, and URL state conventions for the metu Next.js web app.
---

# Page Layout & UX Conventions (apps/web)

Every route under `apps/web/src/app/(app)/**/page.tsx` MUST follow the rules
below. The contract is enforced by the shared primitives exported from
`@metu/ui` and the `(app)/layout.tsx` shell.

## 1. Layout primitives — always use them

Use these components from `@metu/ui` instead of hand-rolled `<div>`/`<header>`
markup. They guarantee consistent spacing, animation, and a11y.

| Primitive        | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `Page`           | Outer page container (`space-y-6` + `data-page=""`).             |
| `PageHeader`     | h1 title + optional description, eyebrow, accent, back, actions. |
| `PageSection`    | h2 section with optional icon, title adornment, and actions.     |
| `PageTransition` | Already mounted in `(app)/layout.tsx`. Do not nest another one.  |
| `BackLink`       | Used internally by `PageHeader` — render via `back={...}`.       |

### Required pattern

```tsx
// Good — all top-level pages look like this.
import { Page, PageHeader, PageSection, Badge } from '@metu/ui';

export default async function ThingsPage() {
  return (
    <Page>
      <PageHeader
        title="Things"
        description="Short, plain-language explanation of what lives here."
        actions={
          <Badge variant="neutral" size="sm">
            {count} total
          </Badge>
        }
      />

      <ThingsToolbar /* nuqs-backed filters live here */ />

      <PageSection title="Active" icon={<Icon className="h-4 w-4" />}>
        <ThingsList items={active} />
      </PageSection>
    </Page>
  );
}
```

### Detail / edit pages — always render a `back` prop

Every page reachable via a parent must show a smart back link. Pass the
fallback `href`; `BackLink` will prefer `router.back()` when the user came
from same-origin in-app history.

```tsx
<PageHeader
  size="sm"
  back={{ href: `/projects/${id}`, label: project.name }}
  title="Edit project"
/>
```

For sub-resources that scroll into a parent section, link to the anchor:
`back={{ href: `/projects/${id}#tasks`, label: project.name }}`.

### Forbidden patterns

- ❌ Raw `<div className="space-y-6">` as the page root. Use `<Page>`.
- ❌ `<header>` + `<h1 className="text-3xl font-semibold tracking-tight">`. Use `PageHeader`.
- ❌ `<Link href="/things">← Things</Link>` rendered manually. Use `back={...}`.
- ❌ `<section className="space-y-3"><h2 className="text-lg font-semibold tracking-tight">…</h2>`.
  Use `<PageSection title="…">`.
- ❌ Wrapping page content in `motion.div` for entrance animation — the shell
  layout already runs `PageTransition` keyed by pathname.

## 2. URL state — single source of truth

All UI state that a user might want to share, reload, or bookmark MUST live
in the URL via `nuqs`. The provider (`NuqsAdapter`) is mounted at the root.

### Conventions

- **Filters / sort:** `useQueryStates({ status: parseAsString.withDefault(''), sort: parseAsString.withDefault('default') }, { shallow: false })`.
  Use `shallow: false` so server components re-render with the new params.
- **Pagination cursor:** key it `before` (descending) or `after` (ascending);
  store the opaque cursor returned by the query function.
- **Tabs:** `tab` query param parsed with `parseAsStringEnum`.
- **Search box:** `q`. Debounce in the client component with
  `useTransition` + `setQueryStates`.
- **Defaults:** read params server-side from the page's `searchParams` prop
  (Promise in Next 15+) and pass facets/results down to a small client
  toolbar component that owns the nuqs hooks.

### Forbidden patterns

- ❌ `useState` for filters/tabs/pagination on listing pages.
- ❌ Reading `window.location.search` directly. Use nuqs everywhere.
- ❌ `router.push('?…')` strings. Use `setQueryStates({ … })`.

## 3. Animation & motion

- The `(app)` layout wraps every page in `PageTransition` (keyed by
  `pathname`). Do not duplicate it.
- Entrance animations on individual items are owned by the `Card` component
  (already animated) and `framer-motion`'s `AnimatePresence` for transient UI
  (toasts, drawers, secret cards).
- Always honor reduced-motion: framer-motion does this automatically; if you
  use CSS transitions, gate them with
  `@media (prefers-reduced-motion: no-preference)`.
- Keep durations between **160–280ms** with the project easing
  `[0.22, 1, 0.36, 1]`. Anything longer feels sluggish.

## 4. Spacing and width

- Outer padding/width is owned by `(app)/layout.tsx` (`max-w-6xl`, padding).
  Pages that need a narrower reading column override per-page:
  `<Page className="mx-auto max-w-3xl">`.
- Inside a page use `space-y-6` (default in `Page`); use `space-y-3` inside a
  `PageSection` (already its default).
- Never set top-margin on the first child of `Page` or `PageSection` — the
  parent already provides rhythm.

## 5. Accessibility

- Exactly one `<h1>` per page; `PageHeader` enforces this.
- Section headings inside a page are `<h2>` via `PageSection`.
- Action targets: minimum 36px tap area on mobile (`h-9` Tailwind class).
- Back links must remain keyboard-focusable; do not suppress the underline
  on focus-visible.

## 6. Adding a new page — checklist

1. Create the route at `apps/web/src/app/(app)/<segment>/page.tsx`.
2. Wrap output in `<Page>` and start with `<PageHeader title=… />`.
3. If reachable from a parent, pass `back={{ href, label }}`.
4. If the page has filters/sort/pagination, build a `*-toolbar.tsx`
   client component that uses `nuqs` and reads facets passed from the
   server component.
5. Group content into one or more `<PageSection>` blocks.
6. Add the route to `apps/web/src/components/sidebar/nav-config.ts` only
   when it is a primary destination — secondary/detail routes are NOT
   added there.
7. Verify with the dev server: header back link works, query params
   survive reload, transition feels smooth.

## 7. Sidebar `NAV` rules

- The sidebar lives in `apps/web/src/components/sidebar/nav-config.ts`.
- Group parents default their click target to the FIRST child. Re-order
  `children` to control which page opens when the parent is clicked.
- A `NavGroup.href` override is allowed but discouraged — keep "click parent
  = open primary child" semantics consistent across groups.
