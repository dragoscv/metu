/**
 * Project Intelligence — momentum scoring + state pulse generation.
 */
import { generateText } from 'ai';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, project, task, timelineEvent } from '@metu/db/schema';
import { getModel, PROJECT_PULSE_SYSTEM } from '@metu/ai';

const HALF_LIFE_DAYS = 7;
const WINDOW_DAYS = 30;

/** Decayed momentum score ∈ [0,1]. */
export async function recomputeMomentum(workspaceId: string, projectId: string) {
  const db = getDb();
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const events = await db
    .select({ kind: timelineEvent.kind, at: timelineEvent.occurredAt })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        eq(timelineEvent.projectId, projectId),
        gte(timelineEvent.occurredAt, since),
      ),
    );

  const weights: Record<string, number> = {
    'commit.pushed': 1.0,
    'pr.merged': 0.9,
    'pr.opened': 0.6,
    'pr.review.approved': 0.7,
    'pr.review.changes_requested': 0.5,
    'pr.review.commented': 0.4,
    'task.completed': 0.8,
    'decision.logged': 0.7,
    'issue.closed': 0.6,
    'issue.opened': 0.4,
    'release.published': 0.9,
    'workflow.failed': 0.5,
    'check.failed': 0.5,
    'security.alert': 0.7,
    'tag.pushed': 0.5,
    'discussion.created': 0.4,
    'capture.created': 0.3,
    'project.velocity_dropped': -0.5,
  };

  let score = 0;
  let lastMeaningful: Date | null = null;
  const now = Date.now();
  for (const e of events) {
    const w = weights[e.kind] ?? 0.1;
    const ageDays = (now - new Date(e.at).getTime()) / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    score += w * decay;
    if (w >= 0.7 && (!lastMeaningful || new Date(e.at) > lastMeaningful)) {
      lastMeaningful = new Date(e.at);
    }
  }

  // Saturate to [0,1] with soft squash. Floor `score` at 0 so the
  // optional negative-weight events (e.g. velocity_dropped) can't push
  // the divisor below 1.
  const normalized = 1 - 1 / (1 + Math.max(0, score));

  await db
    .update(project)
    .set({
      momentumScore: normalized,
      lastMeaningfulActivityAt: lastMeaningful,
    })
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)));

  return { score: normalized, lastMeaningfulActivityAt: lastMeaningful };
}

export async function generateProjectPulse(workspaceId: string, projectId: string) {
  const db = getDb();
  const [proj] = await db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
    .limit(1);
  if (!proj) throw new Error('project not found');

  const recentTasks = await db
    .select({ title: task.title, status: task.status })
    .from(task)
    .where(and(eq(task.projectId, projectId), eq(task.workspaceId, workspaceId)))
    .limit(20);

  const recentCaptures = await db
    .select({ content: capture.content })
    .from(capture)
    .where(and(eq(capture.projectId, projectId), eq(capture.workspaceId, workspaceId)))
    .orderBy(sql`captured_at desc`)
    .limit(10);

  const ctx = [
    `Project: ${proj.name}`,
    `Summary: ${proj.summary ?? '(none)'}`,
    `Momentum: ${proj.momentumScore.toFixed(2)}`,
    `Recent tasks: ${recentTasks.map((t) => `[${t.status}] ${t.title}`).join('; ')}`,
    `Recent captures: ${recentCaptures
      .map((c) => c.content?.slice(0, 200))
      .filter(Boolean)
      .join(' | ')}`,
  ].join('\n');

  const { model, provider, modelId } = await getModel({
    workspaceId,
    intent: 'fast',
  });

  const { text } = await generateText({
    model: model as Parameters<typeof generateText>[0]['model'],
    system: PROJECT_PULSE_SYSTEM,
    prompt: ctx,
  });

  await db
    .update(project)
    .set({ stateSummary: text.trim() })
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)));

  return { pulse: text.trim(), provider, modelId };
}
