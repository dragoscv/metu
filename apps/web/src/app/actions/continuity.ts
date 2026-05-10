'use server';
/**
 * Continuity server actions — generate + persist "where was I?" briefings.
 *
 * The engine in `@metu/core/continuity` aggregates last decisions / blockers /
 * captures / events for a project and asks the reasoning model to produce a
 * 4-paragraph narrative ending in the smallest next step. We persist the
 * result in `continuity_briefing` so the project page can render the latest
 * one immediately, with a button to regenerate.
 */
import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { continuityBriefing, project } from '@metu/db/schema';
import { restoreProjectContext } from '@metu/core/continuity';
import { inngest } from '@/inngest/client';

const ProjectIdSchema = z.string().uuid();

export interface BriefingRow {
  id: string;
  briefing: string;
  modelProvider: string | null;
  modelId: string | null;
  generatedAt: string;
}

/** Briefings older than this are considered stale and trigger a prewarm. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function getLatestBriefing(projectId: string): Promise<BriefingRow | null> {
  const parsed = ProjectIdSchema.safeParse(projectId);
  if (!parsed.success) return null;
  projectId = parsed.data;
  const session = await auth();
  if (!session) return null;
  const db = getDb();
  const [row] = await db
    .select({
      id: continuityBriefing.id,
      briefing: continuityBriefing.briefing,
      modelProvider: continuityBriefing.modelProvider,
      modelId: continuityBriefing.modelId,
      generatedAt: continuityBriefing.generatedAt,
    })
    .from(continuityBriefing)
    .where(
      and(
        eq(continuityBriefing.workspaceId, session.user.workspaceId),
        eq(continuityBriefing.projectId, projectId),
      ),
    )
    .orderBy(desc(continuityBriefing.generatedAt))
    .limit(1);

  // Fire-and-forget prewarm if the briefing is stale or missing. The
  // Inngest function is debounced per-project so concurrent visits
  // collapse to one LLM call.
  const isStale = !row || Date.now() - row.generatedAt.getTime() > STALE_AFTER_MS;
  if (isStale) {
    void inngest
      .send({
        name: 'continuity/prewarm',
        data: {
          workspaceId: session.user.workspaceId,
          projectId,
          reason: row ? 'stale' : 'missing',
        },
      })
      .catch(() => {
        // Background prewarm best-effort; do not block the page render.
      });
  }

  if (!row) return null;
  return {
    id: row.id,
    briefing: row.briefing,
    modelProvider: row.modelProvider,
    modelId: row.modelId,
    generatedAt: row.generatedAt.toISOString(),
  };
}

export async function restoreContextAction(
  projectId: string,
): Promise<{ ok: true; row: BriefingRow } | { ok: false; error: string }> {
  const parsed = ProjectIdSchema.safeParse(projectId);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  projectId = parsed.data;
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const db = getDb();

  // Workspace scoping: confirm the project belongs here before we burn LLM tokens.
  const [proj] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!proj) return { ok: false, error: 'project_not_found' };

  let result: Awaited<ReturnType<typeof restoreProjectContext>>;
  try {
    result = await restoreProjectContext(session.user.workspaceId, projectId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'restore_failed' };
  }

  const [inserted] = await db
    .insert(continuityBriefing)
    .values({
      workspaceId: session.user.workspaceId,
      projectId,
      briefing: result.briefing,
      modelProvider: result.provider,
      modelId: result.modelId,
    })
    .returning();
  if (!inserted) return { ok: false, error: 'persist_failed' };

  revalidatePath(`/projects/${projectId}`);
  return {
    ok: true,
    row: {
      id: inserted.id,
      briefing: inserted.briefing,
      modelProvider: inserted.modelProvider,
      modelId: inserted.modelId,
      generatedAt: inserted.generatedAt.toISOString(),
    },
  };
}
