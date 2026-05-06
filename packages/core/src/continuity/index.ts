/**
 * Context Continuity — "where was I?" briefing.
 *
 * Aggregates last decisions/captures/commits/blockers for a project and
 * generates a 4-paragraph narrative that tells the user the smallest next step.
 */
import { generateText } from 'ai';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, decision, project, task, timelineEvent } from '@metu/db/schema';
import { getModel, CONTINUITY_RESTORE_SYSTEM } from '@metu/ai';

export async function restoreProjectContext(workspaceId: string, projectId: string) {
  const db = getDb();
  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
    .limit(1);
  if (!proj) throw new Error('project not found');

  const [decisions, blockers, captures, events] = await Promise.all([
    db
      .select({
        title: decision.title,
        rationale: decision.rationale,
        decidedAt: decision.decidedAt,
      })
      .from(decision)
      .where(and(eq(decision.projectId, projectId), eq(decision.workspaceId, workspaceId)))
      .orderBy(desc(decision.decidedAt))
      .limit(5),
    db
      .select({ title: task.title, blockedReason: task.blockedReason })
      .from(task)
      .where(
        and(
          eq(task.projectId, projectId),
          eq(task.workspaceId, workspaceId),
          eq(task.status, 'blocked'),
        ),
      )
      .limit(5),
    db
      .select({ content: capture.content, capturedAt: capture.capturedAt })
      .from(capture)
      .where(and(eq(capture.projectId, projectId), eq(capture.workspaceId, workspaceId)))
      .orderBy(desc(capture.capturedAt))
      .limit(8),
    db
      .select({
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(
        and(eq(timelineEvent.projectId, projectId), eq(timelineEvent.workspaceId, workspaceId)),
      )
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(15),
  ]);

  const ctx = JSON.stringify(
    {
      project: {
        name: proj.name,
        summary: proj.summary,
        pulse: proj.stateSummary,
        momentum: proj.momentumScore,
        lastActivity: proj.lastMeaningfulActivityAt,
      },
      lastDecisions: decisions,
      openBlockers: blockers,
      recentCaptures: captures.map((c) => ({
        ...c,
        content: c.content?.slice(0, 500),
      })),
      recentEvents: events,
    },
    null,
    2,
  );

  const { model, provider, modelId } = await getModel({
    workspaceId,
    intent: 'reasoning',
  });
  const { text } = await generateText({
    model: model as Parameters<typeof generateText>[0]['model'],
    system: CONTINUITY_RESTORE_SYSTEM,
    prompt: ctx,
  });

  return { briefing: text.trim(), provider, modelId };
}
