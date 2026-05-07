---
applyTo: 'packages/ui/**,apps/web/src/components/**/*.tsx,apps/web/src/app/**/*.tsx,**/*.css'
description: Tailwind v4 + shadcn-style UI — themes, tokens, Card/Badge/StatusDot, motion.
---

# UI, styling & themes

## Tailwind v4, CSS-first

- **No `tailwind.config.js`.** Tokens live in `packages/ui/src/styles.css`
  inside `@theme { ... }` (and theme overrides under
  `[data-theme='glass'|'minimal'|'dense'|'soft']`).
- PostCSS plugin: `@tailwindcss/postcss` (configured in
  `apps/web/postcss.config.mjs`).
- Use `clsx` for conditional class strings, `tailwind-merge` (`cn()`) when
  composing variants. Shadcn-style components use `cva` (class-variance-authority).

## Use the primitives — never hand-roll

Layout / page structure (from `@metu/ui`):

- `<Page>` — root container (`space-y-6`, `data-page=""`).
- `<PageHeader>` — `h1`, optional description, eyebrow, accent, `back`,
  `actions`. **Exactly one per page.**
- `<PageSection>` — `h2` + optional icon + actions.
- `<PageTransition>` — already mounted in `(app)/layout.tsx`. Don't nest.
- `<BackLink>` — used internally by `PageHeader` via the `back={...}` prop.

Atoms / molecules (from `@metu/ui`):

- `<Button>`, `<Input>`, `<Select>`, `<SegmentedControl>`, `<KeyHint>`,
  `<Skeleton>`, `<EmptyState>`, `<MomentumBar>`.
- `<Card>` — variants `default | glass | elevated | outline`, plus
  `interactive`. Sets `data-card` and `data-card-variant` so theme
  stylesheets can target per-variant.
- `<Badge>` — variants `success | warning | danger | info | neutral | brand | outline`,
  sizes `xs | sm | md`. Use this instead of hardcoded Tailwind palette chips.
- `<StatusDot>` — states `success | warning | danger | info | brand | neutral | offline`,
  sizes `xs | sm | md | lg`, optional `pulse`.

Detailed page-layout rules live in
[page-layout.instructions.md](./page-layout.instructions.md).

## Themes

Four themes via `data-theme` on `<html>`:

| Theme     | When                                  |
| --------- | ------------------------------------- |
| `glass`   | Default fancy/marketing-ish look      |
| `minimal` | Dark resolved from system preference  |
| `dense`   | Information-dense (compact spacing)   |
| `soft`    | Light resolved from system preference |

`apps/web/src/components/theme-provider.tsx` resolves `system` → minimal/soft
based on `prefers-color-scheme`. A pre-paint `<ThemeScript>` reads
`localStorage('metu:theme')` to avoid FOUC. Don't add a 5th theme without
updating the picker, the system mapping, and the `@theme` overrides.

## Semantic state tokens

For each of `success | warning | danger | info | neutral`,
`packages/ui/src/styles.css` exposes:

- `--color-{state}` — solid tone
- `--color-{state}-fg` — text on that tone
- `--color-{state}-bg` — soft surface
- `--color-{state}-border` — border on the soft surface

Always use the token (`bg-[var(--color-success-bg)]` or via the cva variant
on `Badge`/`StatusDot`). **Never** hardcode `bg-emerald-500/10` etc.

## Motion

- Library: `framer-motion`. Default duration `160–280ms`, easing
  `[0.22, 1, 0.36, 1]`.
- The `(app)` layout already runs a `PageTransition` keyed by `pathname`.
  Don't wrap pages in another `motion.div` for entry animation.
- For lists, stagger via `AnimatePresence` + `layout`. Keep the impulse
  small — this app is not a marketing page.
- Honor `prefers-reduced-motion`. framer-motion does it automatically;
  guard CSS transitions with `@media (prefers-reduced-motion: no-preference)`.
- `layoutId="sidebar-active"` is the shared pill across sidebar leaves and
  collapsed parents. Don't reuse this layoutId elsewhere.

## Forms

- Simple form (single field, single button): use `useActionState` with a
  Server Action. Render errors inline below the field.
- Complex form: `react-hook-form` + `@hookform/resolvers/zod`. Submit calls
  the same Server Action.
- Use the `<Input>` and `<Button>` primitives — don't reach for raw
  `<input>` / `<button>` except for native semantics.

## URL state

See [page-layout.instructions.md](./page-layout.instructions.md) §2. TL;DR:
nuqs everywhere; never `useState` for shareable filters/tabs/pagination.

## Accessibility

- Tap targets ≥ 36px on mobile (`h-9` or larger).
- Focus-visible rings must be visible. Don't `outline-none` without a
  replacement ring.
- One `<h1>` per page (`PageHeader` enforces).
- `<StatusDot>` is decorative — pair it with a `<Badge>` or text label;
  don't communicate state by color alone.

## What NOT to do

- ❌ Hardcoded Tailwind color palette (`bg-amber-500/20`, `text-emerald-700`)
  in app code. Use semantic tokens or Badge/StatusDot variants.
- ❌ Wrapping a custom div in `data-card` without setting `data-card-variant`
  — glass theme blur targets `[data-card-variant]`.
- ❌ Adding a top-level `<header>` / `<h1>` directly. Use `PageHeader`.
- ❌ Per-page `motion.div` entrance wrappers. The shell handles it.
- ❌ Inline `<style>` blocks in components. Tokens live in `styles.css`.
