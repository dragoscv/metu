/**
 * SDK v1 — POST /api/sdk/v1/brief
 *
 * Bearer auth (`tools:invoke` scope). On-demand briefing generation: given
 * a `projectId`, runs `restoreProjectContext()` and persists a new
 * `continuity_briefing` row. Returns the briefing text + smallest-next-step
 * paragraph so the caller can render immediately. Lets external clients
 * (vscode-ext, companion, mobile) trigger "regenerate brief now" without
 * navigating to the web UI.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { restoreProjectContext } from '@metu/core/continuity';
import { getDb } from '@metu/db';
import { continuityBriefing, project } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';

const schema = z.object({
  projectId: z.string().uuid(),
});

function nextStepParagraph(briefing: string): string {
  const paras = briefing
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const last = paras[paras.length - 1] ?? briefing.trim();
  return last.length > 600 ? last.slice(0, 597).replace(/\s+\S*$/, '') + '…' : last;
}

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'tools:invoke')) return forbidden();

  const limited = await rateLimit('sdk-brief', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [proj] = await db
    .select({ id: project.id, name: project.name })
    .from(project)
    .where(and(eq(project.id, parsed.data.projectId), eq(project.workspaceId, session.workspaceId)))
    .limit(1);
  if (!proj) {
    return NextResponse.json({ ok: false, error: 'project_not_found' }, { status: 404 });
  }

  let result: Awaited<ReturnType<typeof restoreProjectContext>>;
  try {
    result = await restoreProjectContext(session.workspaceId, proj.id);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'restore_failed' },
      { status: 502 },
    );
  }

  const [row] = await db
    .insert(continuityBriefing)
    .values({
      workspaceId: session.workspaceId,
      projectId: proj.id,
      briefing: result.briefing,
      modelProvider: result.provider,
      modelId: result.modelId,
    })
    .returning();
  if (!row) {
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    projectId: proj.id,
    projectName: proj.name,
    briefingId: row.id,
    briefing: row.briefing,
    nextStep: nextStepParagraph(row.briefing),
    modelProvider: row.modelProvider,
    modelId: row.modelId,
    generatedAt: row.generatedAt.toISOString(),
  });
}
