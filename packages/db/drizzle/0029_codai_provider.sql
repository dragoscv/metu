-- Make codai (ai.codai.ro) a first-class AI provider.
-- Adds the `codai` value to the ai_provider_kind enum used by
-- provider_credential.provider and agent_run.provider.
-- Idempotent — ADD VALUE IF NOT EXISTS is safe to re-run.

ALTER TYPE "ai_provider_kind" ADD VALUE IF NOT EXISTS 'codai';
