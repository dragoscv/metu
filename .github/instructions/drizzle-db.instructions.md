---
applyTo: 'packages/db/**/*.ts,apps/web/src/lib/**/*.ts,packages/core/**/*.ts'
description: Drizzle 0.36 + Postgres conventions — schema, migrations, identity columns, workspace scoping.
---

# Drizzle 0.36 + Postgres conventions

## Schema layout

- Schema files live in `packages/db/src/schema/` and re-export from
  `index.ts`. One file per domain (auth, workspace, project, conductor,
  goals, oauth, integrations, memory, health).
- A new domain goes in its own file. Update `schema/index.ts` to re-export it.
- Shared helpers (timestamps, soft-delete) live in `_shared.ts`.

## Required column conventions

Every domain (non-auth) table MUST have:

- `id uuid primary key default gen_random_uuid()` — or `bigint generatedAlwaysAsIdentity()`
  for high-volume append-only logs.
- `workspaceId uuid not null references workspace(id)` — **always**.
- `createdAt timestamp with time zone not null default now()`.
- `updatedAt timestamp with time zone not null default now()`.
- `deletedAt timestamp with time zone null` — soft-delete; queries filter
  `isNull(deletedAt)` unless explicitly exhuming.

Use `withTimezone: true` on every timestamp column.

## Drizzle 0.36 gotchas (will bite you)

1. **`.returning({...projection})` typing breaks** in 0.36. Use no-arg
   `.returning()` and read the full row:
   ```ts
   const [row] = await db.insert(task).values(...).returning();
   ```
2. **Relational queries** (`db.query.task.findMany(...)`) work, but always
   include `with: { ... }` explicitly — implicit relations don't exist.
3. **`pgEnum`** values cannot be reordered or removed without a manual
   migration (`ALTER TYPE ... ADD VALUE`). Always `ADD`, never edit.
4. **Index naming** is required for partial unique indexes — see the
   `tool_acl` pair (`integration_id IS NULL` / `IS NOT NULL`).

## Workspace scoping is mandatory

Every query that reads or writes a domain row MUST filter by `workspaceId`:

```ts
await db
  .select()
  .from(task)
  .where(and(eq(task.workspaceId, workspaceId), isNull(task.deletedAt)));
```

This is the #1 multi-tenant bug class — a missing `workspaceId` check leaks
across tenants. Code review specifically watches for this.

## Migrations

- Generate from schema diff: `pnpm db:generate` — produces a numbered
  `drizzle/<n>_*.sql` and updates the journal.
- Apply locally: `pnpm db:push` (preferred for dev — bypasses journal
  mismatches). The migration runner reads `.env.local` (added in 14b).
- **Make every new migration idempotent.** Existing migrations
  `0001`–`0003` are NOT idempotent and will fail if re-run; new ones must
  guard with `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `IF NOT EXISTS`, etc. CI re-runs migrations against a fresh DB.
- **Never edit a committed migration.** Add a new one that fixes forward.
- Commit the generated `.sql` and the updated `_journal.json`.

## Extensions

The DB requires:

- `pgvector` (vector embeddings — `memory_chunk.vector`).
- `pg_trgm` (fuzzy text search alongside FTS).

Both are created by `infra/docker/postgres-init.sql` for local and by the
first migration for prod. Don't add a CREATE EXTENSION in app code.

## Identity vs UUID

- UUIDs by default for cross-service safety (devices, OAuth, etc).
- Use `bigint generatedAlwaysAsIdentity()` for high-write append-only logs
  (e.g. `timeline_event`, `device_event`, `tool_call`) where ordering matters
  more than global uniqueness.

## Querying patterns

- Prefer `db.select().from(...)` over `db.query.x.findMany(...)` in hot
  paths — the query builder is more transparent.
- For semantic search use the helper in `@metu/core/memory` — never write
  raw `cosine_distance` SQL outside that module.
- Wrap multi-statement writes in `db.transaction(async (tx) => { ... })`.
  Tool execution + audit row + timeline event MUST be in one transaction.

## What NOT to do

- ❌ `serial` columns — always identity.
- ❌ `text` for IDs — always uuid (or bigint identity).
- ❌ Forget `workspaceId` in a `where`.
- ❌ Edit a committed migration.
- ❌ Skip soft-delete (`deletedAt`) for domain rows.
