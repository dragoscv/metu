-- Slice: external integration resources + project links.

CREATE TABLE IF NOT EXISTS "integration_resource" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "integration_id" uuid REFERENCES "integration"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "kind" text NOT NULL,
  "external_id" text NOT NULL,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_synced_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_resource_unique_idx"
  ON "integration_resource" ("workspace_id", "provider", "external_id");
CREATE INDEX IF NOT EXISTS "integration_resource_workspace_idx"
  ON "integration_resource" ("workspace_id");
CREATE INDEX IF NOT EXISTS "integration_resource_integration_idx"
  ON "integration_resource" ("integration_id");
CREATE INDEX IF NOT EXISTS "integration_resource_provider_idx"
  ON "integration_resource" ("provider", "kind");

CREATE TABLE IF NOT EXISTS "project_link" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "resource_id" uuid REFERENCES "integration_resource"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "url" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "added_by" uuid REFERENCES "user"("id") ON DELETE SET NULL,
  "added_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_link_unique_idx"
  ON "project_link" ("project_id", "url");
CREATE INDEX IF NOT EXISTS "project_link_workspace_idx"
  ON "project_link" ("workspace_id");
CREATE INDEX IF NOT EXISTS "project_link_project_idx"
  ON "project_link" ("project_id");
CREATE INDEX IF NOT EXISTS "project_link_resource_idx"
  ON "project_link" ("resource_id");
CREATE INDEX IF NOT EXISTS "project_link_provider_idx"
  ON "project_link" ("provider", "kind");
