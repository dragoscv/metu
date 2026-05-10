/**
 * Right-to-export — returns a JSON archive of all the user's workspace
 * data. Required for GDPR-style data portability and for letting power
 * users back up their continuity briefings before churning.
 *
 * Auth: session cookie (no bearer SDK), workspace owner only. Streams a
 * single JSON blob; for very large workspaces this should move to a
 * background job + signed URL, but the schema is small enough today
 * (memos, captures, briefings, timeline) that one request is fine.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import {
  capture,
  continuityBriefing,
  decision,
  goal,
  project,
  timelineEvent,
  toolCall,
  workspace,
  workspaceMember,
} from '@metu/db/schema';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const workspaceId = session.user.workspaceId;
  const userId = session.user.id;

  const db = getDb();

  // Owner-only: workspace export reveals every member's content. We
  // guard by membership role rather than by `workspace.ownerId` to keep
  // future multi-owner workspaces working.
  const [member] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(eq(workspaceMember.userId, userId))
    .limit(1);
  if (!member || member.role !== 'owner') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const [workspaceRow, projects, goals, captures, decisions, briefings, timeline, toolCalls] =
      await Promise.all([
        db.select().from(workspace).where(eq(workspace.id, workspaceId)).limit(1),
        db.select().from(project).where(eq(project.workspaceId, workspaceId)),
        db.select().from(goal).where(eq(goal.workspaceId, workspaceId)),
        db.select().from(capture).where(eq(capture.workspaceId, workspaceId)),
        db.select().from(decision).where(eq(decision.workspaceId, workspaceId)),
        db.select().from(continuityBriefing).where(eq(continuityBriefing.workspaceId, workspaceId)),
        db.select().from(timelineEvent).where(eq(timelineEvent.workspaceId, workspaceId)),
        db.select().from(toolCall).where(eq(toolCall.workspaceId, workspaceId)),
      ]);

    const archive = {
      meta: {
        version: 1,
        exportedAt: new Date().toISOString(),
        workspaceId,
        exportedBy: userId,
      },
      workspace: workspaceRow[0] ?? null,
      projects,
      goals,
      captures,
      decisions,
      briefings,
      timelineEvents: timeline,
      toolCalls,
    };

    log.info('workspace.export.completed', {
      workspaceId,
      userId,
      counts: {
        projects: projects.length,
        goals: goals.length,
        captures: captures.length,
        decisions: decisions.length,
        briefings: briefings.length,
        timelineEvents: timeline.length,
        toolCalls: toolCalls.length,
      },
    });

    const filename = `metu-export-${workspaceId}-${new Date().toISOString().slice(0, 10)}.json`;
    return new NextResponse(JSON.stringify(archive, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    log.error('workspace.export.failed', { workspaceId, userId }, err);
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }
}
