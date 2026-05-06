CREATE TYPE "public"."workspace_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('active', 'paused', 'archived', 'killed');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('deep', 'shallow', 'creative', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('inbox', 'next', 'doing', 'blocked', 'done', 'dropped');--> statement-breakpoint
CREATE TYPE "public"."capture_kind" AS ENUM('text', 'voice', 'screenshot', 'link', 'code', 'email', 'message', 'file');--> statement-breakpoint
CREATE TYPE "public"."capture_status" AS ENUM('received', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."memory_source_kind" AS ENUM('capture', 'task', 'decision', 'project_summary', 'repo_file', 'commit', 'email', 'message', 'agent_run', 'manual');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('pending', 'running', 'success', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_kind" AS ENUM('anthropic', 'openai', 'azure_openai', 'google', 'vertex', 'copilot', 'ollama', 'custom');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('github', 'google', 'gmail', 'gcal', 'telegram', 'whatsapp', 'stripe', 'vercel', 'firebase', 'spotify', 'slack', 'notion', 'linear', 'browser', 'vscode', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'paused', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."autonomy_mode" AS ENUM('observe', 'ask', 'auto_with_undo', 'autopilot');--> statement-breakpoint
CREATE TYPE "public"."conversation_kind" AS ENUM('conductor', 'side', 'project', 'tool');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('active', 'archived', 'pinned');--> statement-breakpoint
CREATE TYPE "public"."device_kind" AS ENUM('web', 'mobile', 'vscode_ext', 'browser_ext', 'companion_desktop', 'mcp_client', 'external_app', 'cli');--> statement-breakpoint
CREATE TYPE "public"."device_presence" AS ENUM('online', 'idle', 'offline');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('system', 'user', 'assistant', 'tool');--> statement-breakpoint
CREATE TYPE "public"."notification_urgency" AS ENUM('low', 'normal', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."oauth_client_type" AS ENUM('first_party', 'third_party', 'public');--> statement-breakpoint
CREATE TYPE "public"."oauth_token_kind" AS ENUM('authorization_code', 'access_token', 'refresh_token', 'device_code');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('pending', 'awaiting_approval', 'approved', 'rejected', 'running', 'success', 'failed', 'undone', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "authenticator" (
	"credential_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" integer NOT NULL,
	"credential_device_type" text NOT NULL,
	"credential_backed_up" boolean NOT NULL,
	"transports" text,
	CONSTRAINT "authenticator_user_id_credential_id_pk" PRIMARY KEY("user_id","credential_id"),
	CONSTRAINT "authenticator_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_token" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_token_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"provider_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_cost_cap_usd" text,
	"unlimited_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_member" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "focus_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"now_task_id" uuid,
	"next_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ignored_project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rationale" text,
	"energy_level" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"summary" text,
	"state_summary" text,
	"status" "project_status" DEFAULT 'active' NOT NULL,
	"momentum_score" double precision DEFAULT 0 NOT NULL,
	"last_meaningful_activity_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"status" "task_status" DEFAULT 'inbox' NOT NULL,
	"kind" "task_kind" DEFAULT 'shallow' NOT NULL,
	"leverage_score" double precision,
	"blocked_reason" text,
	"ai_suggested" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "capture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" "capture_kind" NOT NULL,
	"status" "capture_status" DEFAULT 'received' NOT NULL,
	"content" text,
	"storage_key" text,
	"source_url" text,
	"source" text DEFAULT 'web' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memory_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"source_kind" "memory_source_kind" NOT NULL,
	"source_id" uuid,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "timeline_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"importance" double precision DEFAULT 0.5 NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"intent" text NOT NULL,
	"provider_used" "ai_provider_kind",
	"model_used" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"status" "agent_run_status" DEFAULT 'pending' NOT NULL,
	"input_preview" text,
	"output_preview" text,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"kind" "integration_kind" NOT NULL,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"token_ciphertext" text,
	"token_iv" text,
	"refresh_token_ciphertext" text,
	"refresh_token_iv" text,
	"expires_at" timestamp with time zone,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_credential" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "ai_provider_kind" NOT NULL,
	"label" text NOT NULL,
	"api_key_ciphertext" text NOT NULL,
	"api_key_iv" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"key_ref" text DEFAULT 'master' NOT NULL,
	"endpoint" text,
	"default_model" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_app" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"discovery_url" text,
	"authorize_url" text NOT NULL,
	"token_url" text NOT NULL,
	"userinfo_url" text,
	"revoke_url" text,
	"client_id" text NOT NULL,
	"client_secret_ciphertext" text NOT NULL,
	"client_secret_iv" text NOT NULL,
	"client_secret_tag" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"pkce" boolean DEFAULT true NOT NULL,
	"discovered" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid,
	"external_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_tag" text NOT NULL,
	"refresh_token_ciphertext" text,
	"refresh_token_iv" text,
	"refresh_token_tag" text,
	"token_type" text DEFAULT 'Bearer' NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_scopes" text DEFAULT '' NOT NULL,
	"identity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "energy_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"energy" integer NOT NULL,
	"mood" integer,
	"sleep_hours" text,
	"note" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"default_mode" "autonomy_mode" DEFAULT 'ask' NOT NULL,
	"daily_cost_cap_usd" double precision DEFAULT 2,
	"daily_action_cap" integer DEFAULT 50,
	"notification_level" integer DEFAULT 40 NOT NULL,
	"quiet_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tick_interval_sec" integer DEFAULT 300 NOT NULL,
	"approval_timeout_sec" integer DEFAULT 86400 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_policy_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"kind" "conversation_kind" DEFAULT 'side' NOT NULL,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"title" text DEFAULT 'New conversation' NOT NULL,
	"summary" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "device_kind" NOT NULL,
	"platform" text NOT NULL,
	"name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"version" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acl" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"presence" "device_presence" DEFAULT 'offline' NOT NULL,
	"push_channel" text,
	"push_token" text,
	"pairing_secret_hash" text,
	"last_seen_at" timestamp with time zone,
	"activity" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_id" uuid,
	"app_id" uuid,
	"agent_run_id" uuid,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"provider" text,
	"model" text,
	"streaming" boolean DEFAULT false NOT NULL,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"urgency" "notification_urgency" DEFAULT 'normal' NOT NULL,
	"source" text DEFAULT 'conductor' NOT NULL,
	"action_url" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"channel" text NOT NULL,
	"payload" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_hash" text,
	"type" "oauth_client_type" DEFAULT 'first_party' NOT NULL,
	"name" text NOT NULL,
	"icon_url" text,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_scopes" text DEFAULT 'openid profile capture:write recall:read notify:write' NOT NULL,
	"webhook_url" text,
	"webhook_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "oauth_client_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid,
	"device_id" uuid,
	"kind" "oauth_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text DEFAULT '' NOT NULL,
	"code_challenge" text,
	"code_challenge_method" text,
	"user_code" text,
	"redirect_uri" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_acl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"mode" "autonomy_mode" NOT NULL,
	"daily_cost_cap_usd" double precision,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tool_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid,
	"message_id" uuid,
	"agent_run_id" uuid,
	"tool" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "tool_call_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"undo_payload" jsonb,
	"acl_mode" text,
	"estimated_cost_usd" double precision,
	"actual_cost_usd" double precision,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "authenticator" ADD CONSTRAINT "authenticator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision" ADD CONSTRAINT "decision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "decision" ADD CONSTRAINT "decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "focus_state" ADD CONSTRAINT "focus_state_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "focus_state" ADD CONSTRAINT "focus_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "focus_state" ADD CONSTRAINT "focus_state_now_task_id_task_id_fk" FOREIGN KEY ("now_task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "task" ADD CONSTRAINT "task_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capture" ADD CONSTRAINT "capture_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capture" ADD CONSTRAINT "capture_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "capture" ADD CONSTRAINT "capture_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_chunk" ADD CONSTRAINT "memory_chunk_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_chunk" ADD CONSTRAINT "memory_chunk_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "timeline_event" ADD CONSTRAINT "timeline_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration" ADD CONSTRAINT "integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integration" ADD CONSTRAINT "integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credential" ADD CONSTRAINT "provider_credential_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_app" ADD CONSTRAINT "oauth_app_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_app_id_oauth_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."oauth_app"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_log" ADD CONSTRAINT "energy_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "energy_log" ADD CONSTRAINT "energy_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_policy" ADD CONSTRAINT "agent_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation" ADD CONSTRAINT "conversation_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device" ADD CONSTRAINT "device_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_event" ADD CONSTRAINT "device_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "device_event" ADD CONSTRAINT "device_event_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "message" ADD CONSTRAINT "message_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_subscription" ADD CONSTRAINT "notification_subscription_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_client_id_oauth_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_token" ADD CONSTRAINT "oauth_token_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_acl" ADD CONSTRAINT "tool_acl_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_message_id_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."message"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tool_call" ADD CONSTRAINT "tool_call_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_member_user_idx" ON "workspace_member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_workspace_idx" ON "decision" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "decision_project_idx" ON "decision" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "focus_state_workspace_user_idx" ON "focus_state" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_workspace_idx" ON "project" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_status_idx" ON "project" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_momentum_idx" ON "project" USING btree ("momentum_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_workspace_idx" ON "task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_project_idx" ON "task" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_leverage_idx" ON "task" USING btree ("leverage_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_workspace_idx" ON "capture" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_user_idx" ON "capture" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_project_idx" ON "capture" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_status_idx" ON "capture" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "capture_captured_at_idx" ON "capture" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_chunk_workspace_idx" ON "memory_chunk" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_chunk_project_idx" ON "memory_chunk" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_chunk_source_idx" ON "memory_chunk" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memory_chunk_embedding_idx" ON "memory_chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m=16,ef_construction=64);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timeline_workspace_occurred_idx" ON "timeline_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timeline_project_occurred_idx" ON "timeline_event" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "timeline_kind_idx" ON "timeline_event" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_workspace_started_idx" ON "agent_run" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_kind_idx" ON "agent_run" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_status_idx" ON "agent_run" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_unique_idx" ON "integration" USING btree ("workspace_id","kind","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_workspace_idx" ON "integration" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "integration_status_idx" ON "integration" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_credential_unique_idx" ON "provider_credential" USING btree ("workspace_id","provider","label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_credential_workspace_idx" ON "provider_credential" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_app_slug_idx" ON "oauth_app" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_app_workspace_idx" ON "oauth_app" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "oauth_connection_unique_idx" ON "oauth_connection" USING btree ("workspace_id","app_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_connection_workspace_idx" ON "oauth_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_log_user_logged_idx" ON "energy_log" USING btree ("user_id","logged_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "energy_log_workspace_idx" ON "energy_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_workspace_idx" ON "conversation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_kind_idx" ON "conversation" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_project_idx" ON "conversation" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_last_message_idx" ON "conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_conductor_singleton_idx" ON "conversation" USING btree ("workspace_id") WHERE "conversation"."kind" = 'conductor';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "device_fingerprint_idx" ON "device" USING btree ("workspace_id","user_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_workspace_idx" ON "device" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_presence_idx" ON "device" USING btree ("presence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_event_workspace_occurred_idx" ON "device_event" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_event_device_occurred_idx" ON "device_event" USING btree ("device_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_event_kind_idx" ON "device_event" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_conversation_idx" ON "message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_workspace_idx" ON "message" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_role_idx" ON "message" USING btree ("role");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_user_created_idx" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_workspace_idx" ON "notification" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_urgency_idx" ON "notification" USING btree ("urgency");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_subscription_user_idx" ON "notification_subscription" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_subscription_device_idx" ON "notification_subscription" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_client_workspace_idx" ON "oauth_client" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_token_client_idx" ON "oauth_token" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_token_user_idx" ON "oauth_token" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_token_kind_idx" ON "oauth_token" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_token_user_code_idx" ON "oauth_token" USING btree ("user_code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tool_acl_unique_idx" ON "tool_acl" USING btree ("workspace_id","tool");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_call_workspace_idx" ON "tool_call" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_call_conversation_idx" ON "tool_call" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_call_status_idx" ON "tool_call" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tool_call_tool_idx" ON "tool_call" USING btree ("tool");