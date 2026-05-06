# metu — terraform

GCP infrastructure for `metu-prod-495423` (region `europe-west1`).

## Bootstrap

```pwsh
# 1. Create the tfstate bucket once (Terraform can't manage its own backend)
gcloud storage buckets create gs://metu-prod-tfstate `
  --project=metu-prod-495423 `
  --location=europe-west1 `
  --uniform-bucket-level-access `
  --public-access-prevention

# 2. Init + apply
cd infra/terraform
terraform init
terraform apply -var="project_number=$(gcloud projects describe metu-prod-495423 --format='value(projectNumber)')"
```

## What gets created

- **GCS bucket** `metu-prod-uploads` — direct browser/mobile uploads via signed URLs
- **Cloud KMS** keyring + `byok-master` key (for V2 BYOK upgrade; V1 uses env)
- **Cloud Run** `metu-worker` service (transcription + heavy AI tasks)
- **Artifact Registry** `containers` repo (Docker images)
- **Secret Manager** secrets: worker token, DB URL, master encryption key
- **Service accounts**:
  - `metu-worker` — Cloud Run runtime identity
  - `metu-web-signer` — used by Vercel to mint signed URLs (export JSON key)
  - `metu-github-deployer` — GitHub Actions via Workload Identity Federation (no keys)
- **Workload Identity Federation** — GitHub Actions → GCP without service account keys

## Post-apply secrets

```pwsh
# Populate Secret Manager values
echo -n "$(openssl rand -base64 48)" | gcloud secrets versions add metu-worker-token --data-file=-
echo -n "$DATABASE_URL" | gcloud secrets versions add metu-database-url --data-file=-
echo -n "$(openssl rand -base64 32)" | gcloud secrets versions add metu-master-encryption-key --data-file=-

# Service account key for Vercel (signed URLs)
gcloud iam service-accounts keys create web-signer.json `
  --iam-account=metu-web-signer@metu-prod-495423.iam.gserviceaccount.com
# → paste this JSON as GCS_SERVICE_ACCOUNT_JSON in Vercel envs (production scope)
```

## V2: Cloud SQL + Memorystore migration path

Uncomment the modules in `optional.tf` to migrate from Neon → Cloud SQL and
Upstash → Memorystore. The schema layer is portable (Drizzle); only the
connection string changes.
