-- Slice 10: per-integration ACL overrides on tool_acl.
ALTER TABLE "tool_acl" ADD COLUMN IF NOT EXISTS "integration_id" uuid;

DROP INDEX IF EXISTS "tool_acl_unique_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "tool_acl_workspace_tool_unique_idx"
  ON "tool_acl" ("workspace_id", "tool")
  WHERE "integration_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "tool_acl_workspace_tool_integration_unique_idx"
  ON "tool_acl" ("workspace_id", "tool", "integration_id")
  WHERE "integration_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "tool_acl_integration_idx" ON "tool_acl" ("integration_id");
