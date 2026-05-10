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

export type WorkspacePreferences = {
  /**
   * BCP-47 language tag the user prefers when no per-persona language is
   * set. Mirrors the persona-level `language` field; voice routes use
   * this as a fallback when `language` is omitted in the body.
   */
  preferredLanguage?: string;
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
