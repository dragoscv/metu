/**
 * Compute the persona prompt context from the database for a single
 * companion turn.
 *
 * The companion-agent's `respond.ts` substitutes `{{userName}}`,
 * `{{language}}`, etc. into persona system prompts. Without this helper
 * those placeholders would always render unfilled — the schema accepts
 * an optional `promptContext`, but no caller populated it before this.
 *
 * Lookup is cheap (two indexed fetches) and falls back gracefully when
 * the user has no display name or the persona is built-in (no row).
 *
 * `recentDigest` is intentionally left undefined for now — populating
 * it requires an embedding-based recall on every turn, which adds ~150ms
 * + cost. We'll wire it in after we have a cached digest (slice-after).
 */
import { getDb } from '@metu/db';
import { user as userTable, persona as personaTable, workspaceRecentDigest } from '@metu/db/schema';
import { and, eq } from 'drizzle-orm';
import { getBuiltInPersona } from '@metu/presence';

export interface PromptContext {
  userName?: string;
  language?: string;
  recentDigest?: string;
}

export async function loadPromptContext(args: {
  workspaceId: string;
  userId: string;
  personaSlug: string;
}): Promise<PromptContext> {
  const db = getDb();
  const [userRow, personaRow, digestRow] = await Promise.all([
    db
      .select({ name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, args.userId))
      .limit(1),
    db
      .select({ language: personaTable.language })
      .from(personaTable)
      .where(
        and(
          eq(personaTable.workspaceId, args.workspaceId),
          eq(personaTable.slug, args.personaSlug),
        ),
      )
      .limit(1),
    db
      .select({ digest: workspaceRecentDigest.digest })
      .from(workspaceRecentDigest)
      .where(eq(workspaceRecentDigest.workspaceId, args.workspaceId))
      .limit(1),
  ]);

  const builtIn = getBuiltInPersona(args.personaSlug);
  const language =
    personaRow[0]?.language ?? (builtIn as { language?: string } | undefined)?.language;

  return {
    userName: userRow[0]?.name ?? undefined,
    language: language ?? undefined,
    recentDigest: digestRow[0]?.digest || undefined,
  };
}
