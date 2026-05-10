output "uploads_bucket" {
  value = google_storage_bucket.uploads.name
}

output "worker_service_url" {
  value       = google_cloud_run_v2_service.worker.uri
  description = "Cloud Run worker URL — set as WORKER_URL in Vercel."
}

output "worker_sa_email" {
  value = google_service_account.worker.email
}

output "web_signer_sa_email" {
  value       = google_service_account.web_signer.email
  description = "Service account whose JSON key Vercel uses for signed URLs."
}

output "github_deployer_sa_email" {
  value       = google_service_account.github_deployer.email
  description = "Used by GitHub Actions via WIF — no key needed."
}

output "wif_provider" {
  value = "projects/${var.project_number}/locations/global/workloadIdentityPools/${google_iam_workload_identity_pool.github.workload_identity_pool_id}/providers/${google_iam_workload_identity_pool_provider.github.workload_identity_pool_provider_id}"
}

output "kms_byok_key" {
  value = google_kms_crypto_key.byok.id
}

output "mcp_server_url" {
  value       = google_cloud_run_v2_service.mcp_server.uri
  description = "Public Streamable HTTP MCP endpoint. Append /mcp; auth via metu_at_* bearer."
}

output "mcp_server_sa_email" {
  value = google_service_account.mcp_server.email
}
