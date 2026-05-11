-- Slice 9b (post-shipping audit): per-workspace gate for the companion-side
-- Ollama bridge. When false (default), the conductor MUST NOT route
-- planning/agent calls through a connected device's local Ollama instance —
-- it stays as an explicit, per-call BYOK choice. Idempotent.
ALTER TABLE "agent_policy"
  ADD COLUMN IF NOT EXISTS "ollama_enabled" boolean NOT NULL DEFAULT false;
