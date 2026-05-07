---
applyTo: '**'
description: Repo-wide conventions for the metu pnpm/turborepo monorepo (Node 22, pnpm catalog, commit style, scripts).
---

# Monorepo conventions

## Package manager

- Always use **pnpm** (≥ 9). Never `npm` or `yarn`. The lockfile is `pnpm-lock.yaml`.
- Filter into a workspace package with `pnpm --filter @metu/<name> <script>`.
- Run repo-wide tasks from the root with Turborepo: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm dev`.

## Catalog versions

- Shared dependency versions live in `pnpm-workspace.yaml` under `catalog:`.
- In each `package.json`, reference them with `"<dep>": "catalog:"`. Never pin
  a different version of a catalog dep inside a package without first updating
  the catalog and discussing the change.

## Workspace package naming

- All internal packages are scoped `@metu/<name>` matching their folder under
  `apps/` or `packages/`.
- Cross-package imports MUST go through the package entry, never relative paths
  that climb out of the package (`'@metu/db'`, not `'../../packages/db/src'`).
- Package `exports` map (in `package.json`) is the source of truth for public
  surface. Add a new subpath there before importing it elsewhere.

## TypeScript

- Strict mode everywhere. Project references via `tsconfig.json` extending
  `@metu/config/tsconfig.next.json` or `tsconfig.node.json`.
- Run typecheck from root: `pnpm typecheck`. CI requires N/N green.
- No `any`. Use `unknown` + zod parse, or a proper type. `as` casts are a smell;
  add a comment if unavoidable.

## Conventional commits

- Format: `type(scope): subject` — enforced by `commitlint.config.cjs`.
- Allowed types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `build`,
  `ci`, `perf`, `style`.
- Allowed scopes are restricted to package/app names: `web`, `hub`, `worker`,
  `companion`, `mobile`, `db`, `core`, `ai`, `ui`, `protocol`, `sdk`, `auth`,
  `integrations`, `vscode-ext`, `browser-ext`, `mcp-server`, `infra`, `docs`,
  `release`, `deps`. If a change spans multiple, use the most-impacted one or
  omit the scope.

## Branches & PRs

- Feature branches off `main`: `feat/short-slug` or `fix/short-slug`.
- One concern per PR; keep diffs < 400 LOC when possible.
- Husky `pre-commit` runs lint-staged + `turbo run lint typecheck`. Never
  `git commit --no-verify` to skip these.

## Scripts you will actually run

| Script               | What it does                                |
| -------------------- | ------------------------------------------- |
| `pnpm dev`           | All apps (parallel) via Turbo               |
| `pnpm typecheck`     | TS project references — must be green       |
| `pnpm lint`          | ESLint flat config (currently apps/web)     |
| `pnpm build`         | Build all packages and apps                 |
| `pnpm db:generate`   | New Drizzle SQL migration from schema diff  |
| `pnpm db:push`       | Apply schema directly (local dev preferred) |
| `pnpm db:studio`     | Drizzle Studio UI                           |
| `pnpm infra:up`      | docker-compose Postgres + MinIO + Mailpit   |
| `pnpm bootstrap:env` | Seed `.env.local` from `.env.example`       |

## Adding a new dependency

1. Check `pnpm-workspace.yaml` `catalog:` first — reuse if present.
2. If new and shared by ≥ 2 packages, add to catalog, then `"<dep>": "catalog:"`.
3. If single-package, add directly to that package's `package.json`.
4. Run `pnpm install` from the root.
5. Re-run `pnpm typecheck` before committing.

## What NOT to do

- ❌ Add a `tailwind.config.js` — Tailwind v4 is CSS-first via `@theme` in
  `packages/ui/src/styles.css`.
- ❌ Add `middleware.ts` to `apps/web` — Next.js 16 uses `proxy.ts`.
- ❌ Hand-edit `pnpm-lock.yaml`. Run `pnpm install` and commit the result.
- ❌ Introduce a new state-management library, ORM, validator, or styling
  system without explicit discussion. The golden stack in
  [`copilot-instructions.md`](../copilot-instructions.md) is locked.
