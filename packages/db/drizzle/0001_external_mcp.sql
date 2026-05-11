-- Idempotent: PG 10+ supports IF NOT EXISTS on enum value adds.
ALTER TYPE "public"."integration_kind" ADD VALUE IF NOT EXISTS 'external_mcp';
