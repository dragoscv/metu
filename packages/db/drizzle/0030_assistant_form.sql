-- Rename the persona form 'pet' → 'assistant' (the desktop companion's
-- floating character is an assistant, not a pet). Also migrates the
-- form_prefs jsonb key and the column default.
-- Idempotent — guarded by pg_enum existence checks so re-runs are no-ops.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'persona_form' AND e.enumlabel = 'pet'
  ) THEN
    ALTER TYPE "persona_form" RENAME VALUE 'pet' TO 'assistant';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "persona"
SET "form_prefs" = ("form_prefs" - 'pet')
  || jsonb_build_object('assistant', COALESCE(("form_prefs"->>'pet')::boolean, false))
WHERE "form_prefs" ? 'pet';
--> statement-breakpoint
ALTER TABLE "persona" ALTER COLUMN "form_prefs"
  SET DEFAULT '{"panel":true,"inWindow":true,"hud":true,"assistant":false}'::jsonb;
