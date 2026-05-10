###############################################################################
# MCP server — public, multi-tenant Streamable HTTP at /mcp
#
# Each request brings its own bearer (`metu_at_*`) so the service is internet-
# facing (`INGRESS_TRAFFIC_ALL`) but always authenticates against the DB.
# No service-to-service auth via IAM — the bearer IS the auth.
###############################################################################
resource "google_service_account" "mcp_server" {
  account_id   = "metu-mcp-server"
  display_name = "metu MCP server (Cloud Run)"
}

# Reads oauth_token rows + writes last_used_at.
# The runTool() codepath hits the same DB so this also covers tool execution.
resource "google_kms_crypto_key_iam_member" "mcp_kms" {
  crypto_key_id = google_kms_crypto_key.byok.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.mcp_server.email}"
}

resource "google_secret_manager_secret_iam_member" "mcp_secret_access" {
  for_each = toset([
    google_secret_manager_secret.database_url.secret_id,
    google_secret_manager_secret.master_key.secret_id,
  ])
  secret_id = each.key
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.mcp_server.email}"
}

resource "google_cloud_run_v2_service" "mcp_server" {
  name     = "metu-mcp-server"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.mcp_server.email
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    # Long timeout to accommodate slow tool calls (editor.copilot_chat,
    # device round-trips). The server's progress heartbeat keeps clients alive.
    timeout = "900s"

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/containers/metu-mcp-server:latest"
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 2
        period_seconds        = 5
        failure_threshold     = 5
        timeout_seconds       = 3
      }
      liveness_probe {
        http_get { path = "/health" }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 3
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "METU_WEB_URL"
        value = "https://${var.domain}"
      }
      env {
        name = "DATABASE_URL"
        value_source { secret_key_ref { secret = google_secret_manager_secret.database_url.secret_id, version = "latest" } }
      }
      env {
        name = "ENCRYPTION_KEY"
        value_source { secret_key_ref { secret = google_secret_manager_secret.master_key.secret_id, version = "latest" } }
      }
    }
  }

  depends_on = [google_project_service.apis, google_artifact_registry_repository.containers]
}

# Allow unauthenticated invocations — auth is bearer-token, not IAM.
resource "google_cloud_run_v2_service_iam_member" "mcp_public" {
  project  = google_cloud_run_v2_service.mcp_server.project
  location = google_cloud_run_v2_service.mcp_server.location
  name     = google_cloud_run_v2_service.mcp_server.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
