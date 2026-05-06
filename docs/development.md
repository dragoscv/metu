# metu — Local development

## Prerequisites

- Node.js 22+
- pnpm 9.15+ (`corepack enable`)
- Docker (optional, for worker image)
- A Neon Postgres dev branch (free tier is enough)
- A Google Cloud project (`metu-prod-495423`) — you only need credentials for **OAuth** locally; signed URLs and KMS can be stubbed.

## 1. Clone & install

```pwsh
git clone https://github.com/<you>/metu.git
cd metu
pnpm install
```

## 2. Environment

Copy the template and fill in:

```pwsh
Copy-Item .env.example .env.local
```

Minimum to boot the web app:

```env
DATABASE_URL=postgres://...neon.../metu?sslmode=require
AUTH_SECRET=<openssl rand -base64 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=http://localhost:3000
MASTER_ENCRYPTION_KEY=<openssl rand -base64 32>   # base64-encoded 32 bytes for AES-256
```

For optional features:

| Variable                   | Used by                                   |
| -------------------------- | ----------------------------------------- |
| `INNGEST_EVENT_KEY`        | event publishing                          |
| `INNGEST_SIGNING_KEY`      | webhook verification                      |
| `UPSTASH_REDIS_REST_URL`   | rate limiting                             |
| `UPSTASH_REDIS_REST_TOKEN` | rate limiting                             |
| `OPENAI_API_KEY`           | embeddings + Whisper fallback (env-level) |
| `ANTHROPIC_API_KEY`        | env-level Claude (BYOK overrides)         |
| `GCS_BUCKET_NAME`          | upload signing                            |
| `GCS_SERVICE_ACCOUNT_JSON` | upload signing                            |
| `WORKER_URL`               | transcription dispatch                    |
| `WORKER_AUTH_TOKEN`        | worker shared secret                      |

## 3. Database

```pwsh
# Apply Drizzle migrations + create extensions (vector, pg_trgm)
pnpm db:push
pnpm db:seed   # optional demo data
```

To browse:

```pwsh
pnpm db:studio
```

## 4. Run

```pwsh
# All apps in parallel via Turborepo
pnpm dev
```

Individual apps:

```pwsh
pnpm --filter @metu/web dev          # http://localhost:3000
pnpm --filter @metu/worker dev       # http://localhost:8080
pnpm --filter @metu/mobile start     # Expo dev server
pnpm --filter @metu/mcp-server dev   # stdio MCP
```

## 5. Sign in

Open <http://localhost:3000>, click **Continue with Google**. On first sign-in
metu auto-creates your **personal workspace**. Drop into `/dashboard` and start
brain-dumping.

## Project layout

```
apps/
  web/          Next.js 16 (Vercel)
  worker/       Cloud Run (Hono-style HTTP)
  mobile/       Expo Router app (iOS + Android)
  mcp-server/   MCP tools over stdio/HTTP
  vscode-ext/   VS Code extension
  browser-ext/  Chrome MV3 extension
packages/
  ai/           BYOK provider mesh + prompts + crypto
  auth/         Auth.js v5 config
  config/       Shared tsconfig + eslint
  core/         Memory / Project / Focus / Continuity engines
  db/           Drizzle schema + queries + migrations
  integrations/ GCS, GitHub, Google, Telegram, Stripe, Vercel
  types/        Zod schemas (shared contracts)
  ui/           Tailwind v4 + shadcn-style components
infra/
  terraform/    GCP infrastructure-as-code
docs/           Architecture, deployment, BYOK, security
```

## Common scripts

| Script             | What it does                       |
| ------------------ | ---------------------------------- |
| `pnpm dev`         | Run all apps (Turbo watches)       |
| `pnpm build`       | Build all packages and apps        |
| `pnpm lint`        | ESLint flat config across the repo |
| `pnpm typecheck`   | TS project references              |
| `pnpm test`        | Vitest in package-scoped projects  |
| `pnpm db:push`     | Apply schema (dev)                 |
| `pnpm db:generate` | Generate SQL migrations            |
| `pnpm clean`       | Remove `dist`, `.next`, `.turbo`   |

## Troubleshooting

- **`vector` extension missing** — make sure your Neon branch is on Postgres ≥ 16 and run `pnpm db:push` once; we create extensions before the schema.
- **Auth callback mismatch** — your Google OAuth app must include `http://localhost:3000/api/auth/callback/google` as an authorized redirect.
- **Voice upload 403** — local dev skips signed URLs unless `GCS_BUCKET_NAME` is set; the brain-dump silently falls back to inline storage.
