# metu — Deployment

Production runs on:

- **Web**: Vercel (`app.metu.ro`)
- **Worker**: Google Cloud Run (`europe-west1`)
- **Database**: Neon (eu-central-1) — switchable to Cloud SQL (see Terraform)
- **Cache / ratelimit**: Upstash Redis
- **Workflows**: Inngest Cloud
- **Mobile**: Expo EAS → App Store + Play Store
- **Browser extension**: Chrome Web Store
- **VS Code extension**: VS Code Marketplace

## 1. GCP bootstrap

See `infra/terraform/README.md`. After `terraform apply`, you have:

- Uploads bucket, KMS keyring, Cloud Run worker (image not yet pushed), Artifact Registry, Secret Manager secrets, three service accounts, Workload Identity Federation pool.

Populate the secrets:

```pwsh
# Worker auth token — share with Vercel as WORKER_AUTH_TOKEN
$tok = -join ((48..122) | Get-Random -Count 48 | % { [char]$_ })
$tok | gcloud secrets versions add metu-worker-token --data-file=-

# Database URL — your Neon production branch
"$env:DATABASE_URL" | gcloud secrets versions add metu-database-url --data-file=-

# Master encryption key — base64-encoded 32 bytes (also goes into Vercel)
[Convert]::ToBase64String((1..32 | % { Get-Random -Maximum 256 })) `
  | gcloud secrets versions add metu-master-encryption-key --data-file=-
```

## 2. GitHub repo configuration

GitHub Actions deploys via Workload Identity Federation — **no service account JSON keys**.

In repository settings:

- **Variables**:
  - `WIF_PROVIDER` = output `wif_provider` from `terraform output`
  - `TURBO_TEAM` (optional, for remote cache)
- **Secrets**:
  - `TURBO_TOKEN` (optional)
  - `DATABASE_URL` (production, used by `db-migrate` workflow)

## 3. Vercel project

- Connect the GitHub repo, set the project root to `apps/web`.
- Build command: `cd ../.. && pnpm turbo run build --filter=@metu/web...`
- Install command: `cd ../.. && pnpm install --frozen-lockfile`
- Output directory: `apps/web/.next`
- Node.js version: 22.x

### Environment variables (Production)

```
DATABASE_URL                   = (Neon production)
AUTH_SECRET                    = (openssl rand -base64 32)
GOOGLE_CLIENT_ID               = ...
GOOGLE_CLIENT_SECRET           = ...
NEXTAUTH_URL                   = https://app.metu.ro

MASTER_ENCRYPTION_KEY          = (same base64 as in Secret Manager)

GCS_BUCKET_NAME                = metu-prod-uploads
GCS_SERVICE_ACCOUNT_JSON       = (paste full JSON of metu-web-signer key)

WORKER_URL                     = (terraform output: worker_service_url)
WORKER_AUTH_TOKEN              = (same as Secret Manager)

INNGEST_EVENT_KEY              = (Inngest cloud)
INNGEST_SIGNING_KEY            = (Inngest cloud)

UPSTASH_REDIS_REST_URL         = ...
UPSTASH_REDIS_REST_TOKEN       = ...

# Optional env-level fallbacks (BYOK overrides per workspace)
OPENAI_API_KEY                 = ...
ANTHROPIC_API_KEY              = ...
```

### DNS

Point `metu.ro` and `app.metu.ro` at Vercel (Vercel auto-issues TLS certs).

## 4. Worker deploy

Push to `main` triggers `.github/workflows/deploy-worker.yml` which:

1. Authenticates via WIF as `metu-github-deployer`
2. Builds `apps/worker/Dockerfile` against the monorepo root
3. Pushes to Artifact Registry
4. `gcloud run deploy metu-worker`

First-time manual trigger: **Actions → deploy-worker → Run workflow**.

## 5. Database migrations

Schema changes are applied via the `db-migrate` workflow (manual dispatch) so
they're explicitly authorised. Pick `production`, the workflow runs `pnpm
--filter @metu/db migrate` against the production `DATABASE_URL`.

## 6. Inngest

In Inngest Cloud, register `https://app.metu.ro/api/inngest` as the app
endpoint and copy the event key + signing key into Vercel.

## 7. Mobile (Expo EAS)

```pwsh
cd apps/mobile
eas build --platform all --profile production
eas submit --platform all
```

`EXPO_PUBLIC_API_URL=https://app.metu.ro` is the only build-time variable
needed; everything else is per-user (token entered in app Settings).

## 8. Browser extension

```pwsh
cd apps/browser-ext
zip -r ../metu-browser-ext.zip . -x "*.git*"
```

Upload to Chrome Web Store dashboard.

## 9. VS Code extension

```pwsh
cd apps/vscode-ext
pnpm build
pnpm package          # produces metu-vscode-0.0.1.vsix
vsce publish
```

## 10. Rollback

- **Web**: Vercel → Deployments → Promote previous.
- **Worker**: `gcloud run services update-traffic metu-worker --to-revisions=<rev>=100`
- **Mobile**: Expo `eas update --branch production --message "rollback"` (OTA only) or store rollback for native.
- **DB**: never `down`-migrate in prod; create a corrective forward migration.
