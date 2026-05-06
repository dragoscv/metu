variable "project_id" {
  type        = string
  description = "GCP project id (e.g. metu-prod-495423)."
  default     = "metu-prod-495423"
}

variable "project_number" {
  type        = string
  description = "GCP project number (used by IAM bindings)."
}

variable "region" {
  type    = string
  default = "europe-west1"
}

variable "domain" {
  type    = string
  default = "metu.ro"
}

variable "github_repo" {
  type        = string
  description = "owner/repo used by Workload Identity Federation."
  default     = "dragoscatalinvladulescu/metu"
}

variable "uploads_bucket" {
  type    = string
  default = "metu-prod-uploads"
}

variable "tfstate_bucket" {
  type    = string
  default = "metu-prod-tfstate"
}
