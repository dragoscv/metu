-- Slice 10: explicit multi-account support for integrations.
-- The (workspace_id, kind, external_id) unique key already permitted multiple
-- accounts per provider; this adds an `is_default` flag so consumers can pick
-- "the" account when several exist for the same kind.
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;

-- Backfill: mark the oldest active row per (workspace, kind) as default.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY workspace_id, kind ORDER BY created_at ASC) AS rn
  FROM "integration"
  WHERE status = 'active'
)
UPDATE "integration" SET is_default = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);

-- Partial unique: at most one default per (workspace, kind).
CREATE UNIQUE INDEX IF NOT EXISTS "integration_default_unique_idx"
  ON "integration" (workspace_id, kind)
  WHERE is_default;
