---
applyTo: '**/*.{test,spec}.{ts,tsx},**/tests/**,**/__tests__/**,**/e2e/**,**/playwright/**'
description: Testing conventions — Vitest 4, Playwright, Testing Library; current state is greenfield.
---

# Testing conventions

## Current state

**Zero test files exist today.** `pnpm test` is a no-op false positive in
CI. The plan below applies when adding the first tests; treat this file as
forward-looking.

## Stack (when we start)

- **Unit / integration**: Vitest 4 (Browser Mode for component tests).
- **Component / interaction**: Testing Library (`@testing-library/react`,
  `@testing-library/user-event`).
- **E2E**: Playwright. Already used informally for visual verification;
  formalize under `apps/web/e2e/` when we add a suite.

## File layout

- Co-locate unit tests next to source: `tools.ts` ↔ `tools.test.ts`.
- Component tests next to component: `badge.tsx` ↔ `badge.test.tsx`.
- E2E specs in `apps/web/e2e/<feature>.spec.ts`.
- Shared fixtures in `__fixtures__/` next to where they're used.

## What to test first (priority)

1. **`packages/core/src/agent/policy.ts`** — `resolveAcl` precedence is
   security-critical. Unit-test every combination (kind / workspace mode /
   tool override / per-integration override).
2. **`apps/web/src/lib/safe-equal.ts`** — `safeEqual` and
   `assertSafeOutboundUrl` (loopback / RFC1918 / metadata IP cases).
3. **`apps/web/src/lib/oauth-provider.ts`** — token issue / consume /
   refresh-rotation / replay → `revokeTokenFamily`.
4. **`apps/web/src/lib/bearer.ts`** — `resolveSession` for dev token,
   OAuth access token, and missing/invalid headers.
5. **Page-level E2E**: sign-in → dashboard → quick-capture → conductor
   chat → notifications bell happy path.

## Conventions

- Tests use `describe('<unit>')` + `it('does <behavior>')`. No nested
  `describe` deeper than 2 levels.
- Snapshot tests are banned for component output (brittle). Assert on
  semantic queries: `getByRole`, `getByLabelText`, `getByText`.
- Mock at the boundary, not the SUT. For DB use a real Postgres test
  schema (set `DATABASE_URL` to a `_test` schema and migrate).
- Each test owns its data: insert → assert → cleanup, or use a
  transaction-rollback helper (to be added).

## Running

- `pnpm test` — turbo runs all package tests in parallel.
- `pnpm --filter @metu/core test` — single package.
- `pnpm --filter @metu/web exec playwright test` — E2E (when added).

## What NOT to do

- ❌ `it.skip`/`it.only` committed to main.
- ❌ Tests that depend on time without `vi.useFakeTimers()`.
- ❌ Hitting external APIs from CI. Mock or use record/replay.
- ❌ Hardcoded UUIDs / dates in fixtures — use factory functions.
- ❌ Snapshots of full component HTML.
