-- Slice: per-repo GitHub statistics snapshot.

CREATE TABLE IF NOT EXISTS "github_repo_stats" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "resource_id" uuid NOT NULL REFERENCES "integration_resource"("id") ON DELETE CASCADE,
  "repo_full_name" text NOT NULL,
  "default_branch" text,
  "primary_language" text,
  "language_bytes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "stargazers" integer NOT NULL DEFAULT 0,
  "forks" integer NOT NULL DEFAULT 0,
  "watchers" integer NOT NULL DEFAULT 0,
  "open_issues" integer NOT NULL DEFAULT 0,
  "open_pull_requests" integer NOT NULL DEFAULT 0,
  "commits_last_7d" integer NOT NULL DEFAULT 0,
  "commits_last_30d" integer NOT NULL DEFAULT 0,
  "additions_last_30d" integer NOT NULL DEFAULT 0,
  "deletions_last_30d" integer NOT NULL DEFAULT 0,
  "merged_prs_last_30d" integer NOT NULL DEFAULT 0,
  "closed_issues_last_30d" integer NOT NULL DEFAULT 0,
  "current_streak_days" integer NOT NULL DEFAULT 0,
  "weekly_commit_histogram" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "top_contributors" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recent_commits" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recent_merged_prs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recent_closed_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "last_commit_at" timestamptz,
  "last_synced_at" timestamptz NOT NULL DEFAULT now(),
  "last_sync_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "github_repo_stats_resource_idx"
  ON "github_repo_stats" ("resource_id");
CREATE INDEX IF NOT EXISTS "github_repo_stats_workspace_idx"
  ON "github_repo_stats" ("workspace_id");
CREATE INDEX IF NOT EXISTS "github_repo_stats_full_name_idx"
  ON "github_repo_stats" ("repo_full_name");
