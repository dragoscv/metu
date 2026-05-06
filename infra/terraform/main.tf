###############################################################################
# Required APIs
###############################################################################
locals {
  required_apis = [
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "speech.googleapis.com",
    "cloudkms.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "compute.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.required_apis)
  service  = each.key
  project  = var.project_id

  disable_on_destroy = false
}

###############################################################################
# GCS — uploads bucket (signed URLs target)
###############################################################################
resource "google_storage_bucket" "uploads" {
  name                        = var.uploads_bucket
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  lifecycle_rule {
    action { type = "Delete" }
    condition {
      age                = 30
      matches_prefix     = ["tmp/"]
      with_state         = "ANY"
    }
  }

  cors {
    origin          = ["https://${var.domain}", "https://app.${var.domain}", "http://localhost:3000"]
    method          = ["GET", "PUT", "POST"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  depends_on = [google_project_service.apis]
}

###############################################################################
# Cloud KMS — for BYOK envelope encryption (V2; V1 uses env master key)
###############################################################################
resource "google_kms_key_ring" "metu" {
  name       = "metu"
  location   = var.region
  depends_on = [google_project_service.apis]
}

resource "google_kms_crypto_key" "byok" {
  name            = "byok-master"
  key_ring        = google_kms_key_ring.metu.id
  rotation_period = "7776000s" # 90 days
  purpose         = "ENCRYPT_DECRYPT"

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }
}

###############################################################################
# Service accounts
###############################################################################
resource "google_service_account" "worker" {
  account_id   = "metu-worker"
  display_name = "metu Cloud Run worker"
}

resource "google_service_account" "web_signer" {
  account_id   = "metu-web-signer"
  display_name = "metu web — signs GCS URLs from Vercel"
}

resource "google_service_account" "github_deployer" {
  account_id   = "metu-github-deployer"
  display_name = "metu GitHub Actions deployer (WIF)"
}

# Worker can read uploads + write to its own outputs prefix
resource "google_storage_bucket_iam_member" "worker_uploads_rw" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# Web signer needs to mint signed URLs (objectViewer + create)
resource "google_storage_bucket_iam_member" "signer_rw" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.web_signer.email}"
}

# Worker → Speech-to-Text
resource "google_project_iam_member" "worker_speech" {
  project = var.project_id
  role    = "roles/speech.client"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Worker → KMS (decrypt provider creds in V2)
resource "google_kms_crypto_key_iam_member" "worker_kms" {
  crypto_key_id = google_kms_crypto_key.byok.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.worker.email}"
}

###############################################################################
# Artifact Registry (Docker images for worker)
###############################################################################
resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "containers"
  format        = "DOCKER"
  description   = "metu container images"
  depends_on    = [google_project_service.apis]
}

###############################################################################
# Cloud Run worker
###############################################################################
resource "google_cloud_run_v2_service" "worker" {
  name     = "metu-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account = google_service_account.worker.email
    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
    timeout = "300s"

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/containers/metu-worker:latest"
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "WORKER_AUTH_TOKEN"
        value_source { secret_key_ref { secret = google_secret_manager_secret.worker_token.secret_id, version = "latest" } }
      }
      env {
        name  = "DATABASE_URL"
        value_source { secret_key_ref { secret = google_secret_manager_secret.database_url.secret_id, version = "latest" } }
      }
      env {
        name  = "MASTER_ENCRYPTION_KEY"
        value_source { secret_key_ref { secret = google_secret_manager_secret.master_key.secret_id, version = "latest" } }
      }
    }
  }

  depends_on = [google_project_service.apis, google_artifact_registry_repository.containers]
}

###############################################################################
# Secret Manager (created empty; values populated via gcloud / GitHub Actions)
###############################################################################
resource "google_secret_manager_secret" "worker_token" {
  secret_id  = "metu-worker-token"
  replication { auto {} }
  depends_on = [google_project_service.apis]
}
resource "google_secret_manager_secret" "database_url" {
  secret_id  = "metu-database-url"
  replication { auto {} }
}
resource "google_secret_manager_secret" "master_key" {
  secret_id  = "metu-master-encryption-key"
  replication { auto {} }
}

resource "google_secret_manager_secret_iam_member" "worker_secret_access" {
  for_each = toset([
    google_secret_manager_secret.worker_token.secret_id,
    google_secret_manager_secret.database_url.secret_id,
    google_secret_manager_secret.master_key.secret_id,
  ])
  secret_id = each.key
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

###############################################################################
# Workload Identity Federation — GitHub Actions → GCP without keys
###############################################################################
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account_iam_member" "github_impersonate" {
  service_account_id = google_service_account.github_deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/attribute.repository/${var.github_repo}"
}

# Deployer needs to push images + deploy Cloud Run + access secrets
resource "google_project_iam_member" "deployer_artifacts" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}
resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}
resource "google_project_iam_member" "deployer_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.github_deployer.email}"
}
