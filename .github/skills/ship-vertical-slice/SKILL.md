---
name: ship-vertical-slice
description: Plan and ship a vertical slice in metu — schema → core → API → UI → verify. Use when the user asks for a new end-to-end feature ("add goals", "wire credential brokerage", "implement intent mirroring", etc.).
---

# Ship a vertical slice

metu ships in **vertical slices**, not horizontal layers. A slice goes
schema → core engine → API/Inngest → UI → verified green typecheck/lint, in
one PR. Slice boundaries are the unit of progress recorded in
`/memories/repo/metu-master-decisions.md`.

## Phase 1 — Plan (before any code)

1. Read `/memories/repo/metu-master-decisions.md` to see what's already shipped
   and what gotchas to avoid.
2. Read `docs/architecture.md` and any relevant `docs/<topic>.md`.
3. Identify the **smallest** complete user-visible outcome. Resist scope.
4. Write the plan as 6–10 numbered steps, each one editable in isolation.
   Include explicit verification at the end.

## Phase 2 — Schema (if needed)

Follow [drizzle-db.instructions.md](../instructions/drizzle-db.instructions.md).

1. Add columns / tables to the relevant file in `packages/db/src/schema/`.
2. Re-export from `schema/index.ts` if it's a new file.
3. `pnpm db:generate` → produces `drizzle/<n>_<slug>.sql` + journal entry.
4. **Make the SQL idempotent** (`DO $$ ... EXCEPTION WHEN duplicate_object
THEN null; END $$;`, `IF NOT EXISTS`).
5. `pnpm db:push` to apply locally. Verify in Drizzle Studio.
6. Commit the `.sql` AND the updated `_journal.json`.

## Phase 3 — Core engine logic

Follow [agent-and-conductor.instructions.md](../instructions/agent-and-conductor.instructions.md)
when adding tools.

1. Add pure functions in `packages/core/src/<engine>/`.
2. If it's a new agent capability, register a `ToolDefinition` in
   `packages/core/src/agent/tools.ts` with the right `kind`.
3. If it touches a third-party API, add a sealed config wrapper in
   `packages/integrations/src/<name>/` and use `openSealed`/`Sealed` from
   `@metu/ai/crypto`.

## Phase 4 — Cross-process contract

If the slice talks across web ↔ hub ↔ device ↔ external app:

1. Add the schema to `packages/protocol/src/`. Export the inferred type.
2. Add a method to `@metu/sdk` if external apps will call it.
3. Add the SDK route under `apps/web/src/app/api/sdk/v1/...` —
   see [sdk-and-protocol.instructions.md](../instructions/sdk-and-protocol.instructions.md).
4. Pick / add a scope in `KNOWN_SCOPES` (`packages/auth/src/oauth.ts`)
   and the OIDC discovery doc.

## Phase 5 — Inngest workflows

Follow [inngest-workflows.instructions.md](../instructions/inngest-workflows.instructions.md).

1. Add the event(s) to `Events` in `apps/web/src/inngest/client.ts`.
2. Implement the handler. Wrap every side effect in `step.run`.
3. Set concurrency for fan-out (`{ limit: N, key: 'event.data.workspaceId' }`).
4. Register in `apps/web/src/inngest/route.ts`.
5. For mutating SDK routes, emit `conductor/observe` so the supervisor sees
   the change.

## Phase 6 — UI

Follow [page-layout.instructions.md](../instructions/page-layout.instructions.md)

- [ui-styling.instructions.md](../instructions/ui-styling.instructions.md).

1. Add the page under `apps/web/src/app/(app)/<segment>/page.tsx`.
2. Wrap in `<Page>` + `<PageHeader>`. Group content into `<PageSection>`.
3. URL state via nuqs; never `useState` for shareable filters.
4. Forms: `useActionState` (simple) or `react-hook-form` + zod (complex).
5. Server action lives in `apps/web/src/app/actions/<feature>.ts`.
6. Add the route to `apps/web/src/components/sidebar/nav-config.ts` only if
   it's a primary destination.
7. Add a Cmd+K entry in `command-bar.tsx` if reachable from there.

## Phase 7 — Verify (don't skip)

```pwsh
pnpm typecheck   # must be N/N green
pnpm lint        # apps/web at minimum
```

For DB changes also re-run `pnpm db:push` against a fresh `metu_test`
schema to confirm idempotency.

For UI changes, verify visually via the running dev server
(`http://localhost:3000`). Use Playwright if available.

## Phase 8 — Record the slice

Append a slice entry to `/memories/repo/metu-master-decisions.md`:

```md
## Slice <N> (<feature name>) — <YYYY-MM-DD>

- <bullet list of files / behavior changed>
- **Gotchas**: <anything future agents should know>
- Typecheck N/N green, lint 0/0.
```

## Phase 9 — Commit

- `git add -A`
- Commit with conventional commit format. Scope = the most-impacted
  package (`web`, `core`, `db`, etc.):
  - `feat(core): credential brokerage with ACL gate`
- Push. Open PR. Diff < 400 LOC if you can split it.

## Things that disqualify a "slice complete"

- Typecheck not green.
- New env var not in `.env.example` and `scripts/bootstrap-env.mjs`.
- New event not in the `Events` map.
- Mutating SDK route without `conductor/observe`.
- Migration not idempotent.
- Workspace scoping missing on a query.
