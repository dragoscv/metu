CREATE TABLE IF NOT EXISTS "telegram_chat_link" (
  "chat_id" text PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "persona_slug" text NOT NULL DEFAULT 'metu',
  "linked_by_user_id" uuid NOT NULL,
  "from_user_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_inbound_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_chat_link_workspace_idx" ON "telegram_chat_link" USING btree ("workspace_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "telegram_link_code" (
  "code" text PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspace"("id") ON DELETE CASCADE,
  "issued_by_user_id" uuid NOT NULL,
  "persona_slug" text NOT NULL DEFAULT 'metu',
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telegram_link_code_workspace_idx" ON "telegram_link_code" USING btree ("workspace_id");
