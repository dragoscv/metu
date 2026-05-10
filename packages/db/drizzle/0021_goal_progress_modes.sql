-- Extend goal_progress_mode enum with from_projects + from_decisions modes.
-- Mirrors the schema in packages/db/src/schema/goals.ts.
-- Idempotent: ADD VALUE IF NOT EXISTS is supported on Postgres 12+.

ALTER TYPE "goal_progress_mode" ADD VALUE IF NOT EXISTS 'from_projects';
ALTER TYPE "goal_progress_mode" ADD VALUE IF NOT EXISTS 'from_decisions';
