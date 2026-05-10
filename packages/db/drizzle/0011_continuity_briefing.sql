-- Slice C1: Continuity briefings — persist generated "where was I?" narratives.
CREATE TABLE IF NOT EXISTS "continuity_briefing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"briefing" text NOT NULL,
	"model_provider" text,
	"model_id" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "continuity_briefing" ADD CONSTRAINT "continuity_briefing_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "continuity_briefing" ADD CONSTRAINT "continuity_briefing_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "continuity_briefing_workspace_project_idx" ON "continuity_briefing" ("workspace_id","project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "continuity_briefing_generated_idx" ON "continuity_briefing" ("generated_at");
