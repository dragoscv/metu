/**
 * Proactive message composer.
 *
 * Gathers recent workspace signals and asks the workspace's `chat` model
 * (CodAI by default) to decide whether anything is worth proactively telling
 * the user right now — and if so, to write a short, natural message in the
 * configured tone. Returns null when nothing is worth sending.
 *
 * This is the "smart AI message, not scheduled" brain: the model is the gate.
 * Hard guardrails (quiet hours, caps, spacing) are enforced downstream by
 * `notify()` / `deliverTelegram()`.
 */
import 'server-only';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { generateObject } from 'ai';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { goal, project, task, timelineEvent } from '@metu/db/schema';
import { getModel } from '@metu/ai';
import { log } from '@/lib/logger';

const TONE_GUIDE: Record<string, string> = {
  chief_of_staff:
    'Concise, warm, action-oriented — like a sharp chief of staff. One clear next step.',
  minimal: 'Minimal and terse. Facts only, no fluff. One sentence if possible.',
  friendly: 'Friendly and conversational, encouraging, still brief.',
};

const DecisionSchema = z.object({
  shouldSend: z.boolean(),
  title: z.string().max(80).optional(),
  message: z.string().max(600).optional(),
  reason: z.string().max(200).optional(),
});

export interface ComposeInput {
  workspaceId: string;
  tone: string;
  /** Extra context appended to the prompt (e.g. trigger reason). */
  hint?: string;
}

export interface ComposeResult {
  title: string;
  body: string;
  reason: string;
}

async function gatherSignals(workspaceId: string): Promise<string> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 24 * 3600_000);

  const [recentEvents, openTasks, activeGoals, staleProjects] = await Promise.all([
    db
      .select({ title: timelineEvent.title, kind: timelineEvent.kind })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, dayAgo)))
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(15),
    db
      .select({ title: task.title, status: task.status })
      .from(task)
      .where(and(eq(task.workspaceId, workspaceId), isNull(task.deletedAt)))
      .orderBy(desc(task.updatedAt))
      .limit(10),
    db
      .select({ title: goal.title, progress: goal.progress, drift: goal.drift })
      .from(goal)
      .where(
        and(eq(goal.workspaceId, workspaceId), eq(goal.status, 'active'), isNull(goal.deletedAt)),
      )
      .limit(10),
    db
      .select({ name: project.name, lastAt: project.lastMeaningfulActivityAt })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, workspaceId),
          eq(project.status, 'active'),
          isNull(project.deletedAt),
        ),
      )
      .orderBy(desc(project.lastMeaningfulActivityAt))
      .limit(8),
  ]);

  return JSON.stringify({
    recentEvents,
    openTasks,
    activeGoals,
    staleProjects,
    now: new Date().toISOString(),
  });
}

/**
 * Decide + compose. Returns null when the model judges nothing is worth
 * sending right now.
 */
export async function composeProactiveMessage(input: ComposeInput): Promise<ComposeResult | null> {
  const signals = await gatherSignals(input.workspaceId);
  const toneGuide = TONE_GUIDE[input.tone] ?? TONE_GUIDE.chief_of_staff;

  let model;
  try {
    const resolved = await getModel({ workspaceId: input.workspaceId, intent: 'chat' });
    model = resolved.model;
  } catch (err) {
    log.error('proactive.compose.no_model', { workspaceId: input.workspaceId }, err);
    return null;
  }

  try {
    const { object } = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      schema: DecisionSchema,
      system: [
        'You are METU, a proactive personal AI operating system.',
        'Decide whether anything in the workspace signals is genuinely worth',
        'interrupting the user with a proactive message RIGHT NOW. Be conservative —',
        'only send if it is timely and useful (a deadline, a stall, a clear next step,',
        'a notable win). If nothing is worth it, set shouldSend=false.',
        `Tone for the message: ${toneGuide}`,
        'Keep the message short (1-3 sentences), mobile-friendly, no markdown tables.',
        input.hint ? `Context hint: ${input.hint}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      prompt: `Workspace signals (JSON):\n${signals}`,
    });

    if (!object.shouldSend || !object.message) return null;
    return {
      title: object.title ?? 'METU',
      body: object.message,
      reason: object.reason ?? 'proactive',
    };
  } catch (err) {
    log.error('proactive.compose.failed', { workspaceId: input.workspaceId }, err);
    return null;
  }
}
