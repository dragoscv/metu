---
name: add-db-migration
description: Create, generate, and safely apply a Drizzle migration in metu. Use when the user wants schema changes ("add a column", "new table", "rename"), or after editing `packages/db/src/schema/*`.
---

# Add a Drizzle migration

Drizzle 0.36 + Postgres. The `_journal.json` history matters; previously
shipped migrations 0001–0003 are **not** idempotent, so casual `migrate`
runs against an existing DB will fail. Local dev uses `db:push`; CI uses
fresh DB + `migrate`.

## 1. Edit the schema

In `packages/db/src/schema/<domain>.ts`. Conventions:

- `id uuid` (default) or `bigint generatedAlwaysAsIdentity()` for high-volume.
- `workspaceId uuid not null references workspace(id)` always.
- `createdAt`, `updatedAt`, `deletedAt`, all with `withTimezone: true`.
- Enum values can only be ADDED later, never reordered/removed.

If new file, re-export from `packages/db/src/schema/index.ts`.

## 2. Generate the SQL

```pwsh
pnpm db:generate
```

This compares schema vs the previous snapshot and emits
`packages/db/drizzle/<n>_<auto-slug>.sql` plus updates `_journal.json`.

Open the generated SQL and **make it idempotent**. Templates:

```sql
-- Adding a column
ALTER TABLE "thing" ADD COLUMN IF NOT EXISTS "new_col" text;

-- Creating an enum
DO $$ BEGIN
  CREATE TYPE "thing_kind" AS ENUM ('a', 'b', 'c');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Adding an enum value
ALTER TYPE "thing_kind" ADD VALUE IF NOT EXISTS 'd';

-- Creating a table
CREATE TABLE IF NOT EXISTS "thing" ( ... );

-- Index
CREATE INDEX IF NOT EXISTS "thing_workspace_idx" ON "thing" ("workspace_id");

-- Partial unique index pair (see tool_acl pattern)
CREATE UNIQUE INDEX IF NOT EXISTS "x_a_idx"
  ON "x" ("workspace_id", "tool")
  WHERE "integration_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "x_b_idx"
  ON "x" ("workspace_id", "tool", "integration_id")
  WHERE "integration_id" IS NOT NULL;
```

## 3. Apply locally

```pwsh
pnpm db:push    # preferred for dev
```

`db:push` bypasses the journal and reconciles directly. To verify the
migration file works against a fresh DB:

```pwsh
# (with metu_test schema)
$env:DATABASE_URL = 'postgres://...metu_test...'
pnpm --filter @metu/db migrate
```

The `migrate` runner reads `.env.local` (added in Slice 14b).

## 4. Verify

- `pnpm db:studio` → see the new structure.
- Existing rows look untouched (or got the right defaults).
- Drizzle `select` against the new schema typechecks: `pnpm typecheck`.

## 5. Update the codebase

- Add query helpers in `packages/db/src/queries/` if there are common
  reads/writes. Keep them workspace-scoped.
- Update Zod schemas in `@metu/types` or `@metu/protocol` if the shape
  is exposed across processes.
- For new enum values, also update mirrored arrays in `@metu/types`
  (e.g. `integrationKindSchema`).

## 6. Commit

Commit the schema file, the generated `.sql`, and `_journal.json`
together. Conventional commit:

```
feat(db): add <thing> table for <feature>
```

## What NOT to do

- ❌ Edit a previously committed migration file. Add a new migration that
  fixes forward.
- ❌ Hand-write SQL not produced by `db:generate` unless idempotent and
  reviewed; the journal expects matching hashes.
- ❌ Use `serial` columns. Use identity.
- ❌ Skip the `IF NOT EXISTS` / exception guard. Even if it works locally,
  CI's fresh DB or future re-runs will break.
- ❌ Change an enum's existing values. Always add new ones.
