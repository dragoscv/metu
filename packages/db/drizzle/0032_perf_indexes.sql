-- Performance pass (2026-06 audit) — composite indexes matching the
-- hottest query shapes found in packages/db/src/queries/*. Idempotent.

CREATE INDEX IF NOT EXISTS "timeline_workspace_kind_occurred_idx"
  ON "timeline_event" ("workspace_id", "kind", "occurred_at");

CREATE INDEX IF NOT EXISTS "memory_chunk_workspace_kind_created_idx"
  ON "memory_chunk" ("workspace_id", "source_kind", "created_at");

CREATE INDEX IF NOT EXISTS "tool_call_workspace_status_requested_idx"
  ON "tool_call" ("workspace_id", "status", "requested_at");

CREATE INDEX IF NOT EXISTS "notification_user_ack_created_idx"
  ON "notification" ("user_id", "acknowledged_at", "created_at");

CREATE INDEX IF NOT EXISTS "device_event_workspace_kind_occurred_idx"
  ON "device_event" ("workspace_id", "kind", "occurred_at");

CREATE INDEX IF NOT EXISTS "continuity_briefing_workspace_generated_idx"
  ON "continuity_briefing" ("workspace_id", "generated_at");
