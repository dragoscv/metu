'use server';

/**
 * Week-in-review narrative — AI synthesis of the weekly stats into a
 * 3-paragraph "what happened, what mattered, what's next" story.
 *
 * Cached per (workspace, windowDays) keyed by an inputs hash so repeat
 * visits don't pay an LLM call. Fail-soft: when no BYOK model resolves,
 * we return null and the page renders stats only.
 */
import { createHash } from 'node:crypto';
import { auth } from '@metu/auth';
import { generateText } from 'ai';
import { z } from 'zod';
import { getModel } from '@metu/ai';
import {
  getReviewNarrative,
  upsertReviewNarrative,
  weeklyReviewSummary,
  listTimelineFiltered,
} from '@metu/db/queries';
import { log } from '@/lib/logger';

const inputSchema = z.object({
  windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
  force: z.boolean().optional(),
});

export interface NarrativeResult {
  ok: boolean;
  narrative?: string;
  generatedAt?: string;
  cached?: boolean;
  error?: string;
}

export async function generateReviewNarrativeAction(input: {
  windowDays: 7 | 14 | 30;
  force?: boolean;
}): Promise<NarrativeResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };
  const { windowDays, force } = parsed.data;

  const summary = await weeklyReviewSummary(wsId, windowDays);
  // Nothing happened — don't burn tokens narrating silence.
  if (summary.captures === 0 && summary.toolCalls === 0 && summary.tasksCompleted === 0) {
    return { ok: true, narrative: undefined };
  }

  const inputsHash = createHash('sha256')
    .update(
      JSON.stringify([
        summary.captures,
        summary.toolCalls,
        summary.tasksCompleted,
        summary.projectsTouched,
        summary.goalsAchieved,
        summary.topKinds,
        summary.topProjects.map((p) => [p.id, p.events]),
      ]),
    )
    .digest('hex')
    .slice(0, 32);

  if (!force) {
    const cached = await getReviewNarrative(wsId, windowDays);
    if (cached && cached.inputsHash === inputsHash) {
      return {
        ok: true,
        narrative: cached.narrative,
        generatedAt: cached.generatedAt.toISOString(),
        cached: true,
      };
    }
  }

  // Recent decisions give the narrative substance beyond raw counts.
  const { items: decisions } = await listTimelineFiltered({
    workspaceId: wsId,
    kinds: ['decision.created'],
    since: summary.startedAt,
    cursor: null,
    limit: 10,
  });

  try {
    const { model, provider, modelId } = await getModel({ workspaceId: wsId, intent: 'fast' });
    const { text } = await generateText({
      model: model as Parameters<typeof generateText>[0]['model'],
      system: [
        'You write a concise founder-facing week-in-review. Three short paragraphs:',
        '1) What happened (volume + where attention went).',
        '2) What mattered (decisions, completions, momentum signals).',
        '3) Suggested focus for next week (one concrete suggestion).',
        'Plain prose. No headings, no bullet lists, no emoji, no flattery.',
        'Write in second person ("you"). Max 140 words total.',
      ].join('\n'),
      prompt: JSON.stringify({
        windowDays,
        stats: {
          captures: summary.captures,
          toolCalls: summary.toolCalls,
          failedCalls: summary.toolCallsFailed,
          tasksCompleted: summary.tasksCompleted,
          projectsTouched: summary.projectsTouched,
          goalsActive: summary.goalsActive,
          goalsAchieved: summary.goalsAchieved,
        },
        topActivity: summary.topKinds,
        topProjects: summary.topProjects.map((p) => ({ name: p.name, events: p.events })),
        decisions: decisions.map((d) => d.title).slice(0, 10),
      }),
      abortSignal: AbortSignal.timeout(30_000),
    });

    const narrative = text.trim();
    if (!narrative) return { ok: false, error: 'Empty narrative' };

    await upsertReviewNarrative({
      workspaceId: wsId,
      windowDays,
      narrative,
      inputsHash,
      modelProvider: provider,
      modelId,
    });
    return { ok: true, narrative, generatedAt: new Date().toISOString(), cached: false };
  } catch (err) {
    log.warn('review.narrative.failed', {
      workspaceId: wsId,
      windowDays,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fail-soft: stale cache is better than nothing.
    const stale = await getReviewNarrative(wsId, windowDays);
    if (stale) {
      return {
        ok: true,
        narrative: stale.narrative,
        generatedAt: stale.generatedAt.toISOString(),
        cached: true,
      };
    }
    return { ok: false, error: 'No AI model available' };
  }
}
