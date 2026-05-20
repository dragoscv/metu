'use server';
/**
 * Workspace preferences — small server actions for cosmetic/UX-level
 * settings that live on `workspace.preferences` jsonb rather than their
 * own column. Adding a column for every minor knob would bloat the
 * schema; use this only for free-form preferences.
 */
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { workspace } from '@metu/db/schema';

export type ConductorActivityLevel = 'off' | 'passive' | 'gentle' | 'aggressive';

export type WorkspacePreferences = {
  /**
   * BCP-47 language tag the user prefers when no per-persona language is
   * set. Mirrors the persona-level `language` field; voice routes use
   * this as a fallback when `language` is omitted in the body.
   */
  preferredLanguage?: string;
  /**
   * How proactive the Conductor is when reacting to ambient activity
   * (VS Code heartbeats, browser page visits, device events, etc.).
   *   - off:        ignore the device/event stream entirely.
   *   - passive:    log only; never interrupt the user.
   *   - gentle:     after 30 min idle, propose 'continue where you left off'.
   *                 (default)
   *   - aggressive: detect context switches in real time, ask permission
   *                 to file/categorize, surface the most relevant project.
   */
  conductorActivityLevel?: ConductorActivityLevel;
};

export async function getWorkspacePreferences(): Promise<WorkspacePreferences> {
  const session = await auth();
  if (!session) return {};
  const db = getDb();
  const [row] = await db
    .select({ preferences: workspace.preferences })
    .from(workspace)
    .where(eq(workspace.id, session.user.workspaceId))
    .limit(1);
  return ((row?.preferences as WorkspacePreferences | null) ?? {}) as WorkspacePreferences;
}

const preferredLanguageSchema = z
  .string()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'expected BCP-47 like "en" or "ro-RO"');

export async function setPreferredLanguageAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const raw = formData.get('preferredLanguage');
  const parsed = preferredLanguageSchema.parse(typeof raw === 'string' ? raw : '');
  const db = getDb();
  // jsonb_set merges instead of replacing the whole preferences blob.
  await db
    .update(workspace)
    .set({
      preferences: sql`jsonb_set(coalesce(${workspace.preferences}, '{}'::jsonb), '{preferredLanguage}', to_jsonb(${parsed}::text))`,
    })
    .where(eq(workspace.id, session.user.workspaceId));
  revalidatePath('/settings/profile');
}

const conductorActivityLevelSchema = z.enum(['off', 'passive', 'gentle', 'aggressive']);

export async function setConductorActivityLevelAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const raw = formData.get('conductorActivityLevel');
  const parsed = conductorActivityLevelSchema.parse(typeof raw === 'string' ? raw : '');
  const db = getDb();
  await db
    .update(workspace)
    .set({
      preferences: sql`jsonb_set(coalesce(${workspace.preferences}, '{}'::jsonb), '{conductorActivityLevel}', to_jsonb(${parsed}::text))`,
    })
    .where(eq(workspace.id, session.user.workspaceId));
  revalidatePath('/settings/autonomy');
}

/**
 * Server-readable accessor for the Conductor activity level. Used by the
 * `device/event` reactor to decide whether (and how loudly) to react.
 * Returns the default ('gentle') when the workspace has not configured
 * the field yet.
 */
export async function getConductorActivityLevel(
  workspaceId: string,
): Promise<ConductorActivityLevel> {
  const db = getDb();
  const [row] = await db
    .select({ preferences: workspace.preferences })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);
  const prefs = (row?.preferences as WorkspacePreferences | null) ?? {};
  return prefs.conductorActivityLevel ?? 'gentle';
}
