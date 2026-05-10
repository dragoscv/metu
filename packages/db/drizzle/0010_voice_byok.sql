-- 0010 — slice 5b: voice BYOK reuses provider_credential by extending ai_provider_kind.
-- Idempotent: ALTER TYPE ... ADD VALUE IF NOT EXISTS is supported on Postgres 12+.
ALTER TYPE "ai_provider_kind" ADD VALUE IF NOT EXISTS 'deepgram';
ALTER TYPE "ai_provider_kind" ADD VALUE IF NOT EXISTS 'cartesia';
ALTER TYPE "ai_provider_kind" ADD VALUE IF NOT EXISTS 'elevenlabs';
