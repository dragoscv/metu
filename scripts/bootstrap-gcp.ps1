#!/usr/bin/env pwsh
<#
  metu — GCP dev/prod resource bootstrap.

  This is the *single set of cloud resources* used by both local development
  (when you opt out of Docker) and production until launch. Idempotent —
  re-running is safe.

  What it provisions in `metu-prod-495423`:
    - Required APIs enabled
    - Artifact Registry repo `containers`
    - GCS bucket `metu-prod-uploads` with CORS for localhost + app.metu.ro
    - Service account `metu-web-signer` (used by Vercel / local dev for signed URLs)
        → JSON key downloaded to `.secrets/web-signer.json` (gitignored)
    - Service account `metu-worker` (Cloud Run runtime)
    - Secret Manager secrets seeded from your local `.env.local`

  Prereqs:
    gcloud auth login
    gcloud auth application-default login
    gcloud config set project metu-prod-495423

  Usage:
    pwsh ./scripts/bootstrap-gcp.ps1
#>
[CmdletBinding()]
param(
  [string]$ProjectId = 'metu-prod-495423',
  [string]$Region    = 'europe-west1',
  [string]$Bucket    = 'metu-prod-uploads',
  [switch]$SkipKey
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Write-Host "▶ metu — bootstrapping GCP resources in $ProjectId" -ForegroundColor Cyan

# --- APIs ---
$apis = @(
  'iam.googleapis.com', 'iamcredentials.googleapis.com', 'run.googleapis.com',
  'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com',
  'secretmanager.googleapis.com', 'storage.googleapis.com',
  'speech.googleapis.com', 'cloudkms.googleapis.com'
)
Write-Host "▶ Enabling APIs ($($apis.Count))..."
gcloud services enable @apis --project=$ProjectId | Out-Null

# --- Artifact Registry ---
$repoExists = gcloud artifacts repositories describe containers `
  --project=$ProjectId --location=$Region 2>$null
if (-not $repoExists) {
  Write-Host "▶ Creating Artifact Registry repo 'containers'..."
  gcloud artifacts repositories create containers `
    --repository-format=docker --location=$Region --project=$ProjectId | Out-Null
} else { Write-Host "✓ Artifact Registry repo exists" }

# --- GCS bucket ---
$bucketExists = gcloud storage buckets describe "gs://$Bucket" --project=$ProjectId 2>$null
if (-not $bucketExists) {
  Write-Host "▶ Creating GCS bucket gs://$Bucket..."
  gcloud storage buckets create "gs://$Bucket" `
    --project=$ProjectId --location=$Region `
    --uniform-bucket-level-access --public-access-prevention | Out-Null
} else { Write-Host "✓ Bucket gs://$Bucket exists" }

# CORS — apply every run (cheap)
$corsFile = Join-Path $PSScriptRoot '..' 'infra' 'gcp' 'cors.json'
if (Test-Path $corsFile) {
  gcloud storage buckets update "gs://$Bucket" --cors-file=$corsFile | Out-Null
  Write-Host "✓ CORS applied"
}

# --- Service accounts ---
function Ensure-SA($name, $display) {
  $email = "$name@$ProjectId.iam.gserviceaccount.com"
  $exists = gcloud iam service-accounts describe $email --project=$ProjectId 2>$null
  if (-not $exists) {
    Write-Host "▶ Creating service account $name..."
    gcloud iam service-accounts create $name `
      --display-name=$display --project=$ProjectId | Out-Null
  } else { Write-Host "✓ Service account $name exists" }
  return $email
}

$signerEmail = Ensure-SA 'metu-web-signer' 'metu web — signs GCS URLs'
$workerEmail = Ensure-SA 'metu-worker'     'metu Cloud Run worker'

# Bucket IAM
gcloud storage buckets add-iam-policy-binding "gs://$Bucket" `
  --member="serviceAccount:$signerEmail" --role=roles/storage.objectAdmin --quiet | Out-Null
gcloud storage buckets add-iam-policy-binding "gs://$Bucket" `
  --member="serviceAccount:$workerEmail" --role=roles/storage.objectAdmin --quiet | Out-Null
Write-Host "✓ Bucket IAM bound for signer + worker"

# --- Web signer key (only when needed) ---
if (-not $SkipKey) {
  $secretsDir = Join-Path $PSScriptRoot '..' '.secrets'
  if (-not (Test-Path $secretsDir)) { New-Item -ItemType Directory $secretsDir | Out-Null }
  $keyPath = Join-Path $secretsDir 'web-signer.json'
  if (-not (Test-Path $keyPath)) {
    Write-Host "▶ Creating signer key → $keyPath"
    gcloud iam service-accounts keys create $keyPath `
      --iam-account=$signerEmail --project=$ProjectId | Out-Null
  } else { Write-Host "✓ Signer key already at $keyPath" }
}

# --- Secret Manager (no values yet — populated from .env.local on demand) ---
$secrets = @('metu-database-url', 'metu-master-encryption-key', 'metu-worker-token')
foreach ($s in $secrets) {
  $exists = gcloud secrets describe $s --project=$ProjectId 2>$null
  if (-not $exists) {
    gcloud secrets create $s --replication-policy=automatic --project=$ProjectId | Out-Null
    Write-Host "▶ Created secret $s (empty)"
  } else { Write-Host "✓ Secret $s exists" }
}

Write-Host ""
Write-Host "✅ GCP bootstrap complete." -ForegroundColor Green
Write-Host "   Bucket:        gs://$Bucket"
Write-Host "   Web signer SA: $signerEmail"
Write-Host "   Worker SA:     $workerEmail"
Write-Host ""
Write-Host "Next: paste the contents of .secrets/web-signer.json into Vercel env"
Write-Host "      as GCS_SERVICE_ACCOUNT_JSON when you're ready to ship."
