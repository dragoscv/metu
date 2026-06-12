/**
 * Monday-morning pre-warm of the week-in-review narrative so /review
 * loads instantly with a fresh story instead of paying the LLM latency
 * on first visit. Mirrors generateReviewNarrativeAction's logic via the
 * same query + upsert helpers (action stays the on-demand path).
 *
 * Conservative: only the 7-day window, only workspaces with activity,
 * small concurrency, fail-soft per workspace.
 */
import { createHash } from 'node:crypto';
import { generateText } from 'ai';
import { sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { workspace } from '@metu/db/schema';
import { getReviewNarrative, upsertReviewNarrative, weeklyReviewSummary } from '@metu/db/queries';
import { getModel } from '@metu/ai';
import { inngest } from '../client';
import { log } from '@/lib/logger';

export const reviewNarrativePrewarm = inngest.createFunction(
  {
    id: 'review-narrative-prewarm',
    name: 'Pre-warm week-in-review narratives',
    concurrency: { limit: 2 },
  },
  // Mondays 06:45 UTC — before the digest emails so both share the cache.
  { cron: '45 6 * * 1' },
  async ({ step }) => {
    const workspaces = await step.run('list-workspaces', async () => {
      const db = getDb();
      // workspace-scope-ignore: operator cron fans out per workspace.
      const rows = await db.select({ id: workspace.id }).from(workspace)
        .where(sql`${workspace.id} in (
          select distinct workspace_id from timeline_event
          where occurred_at > now() - interval '7 days'
        )`);
      return rows.map((r) => r.id);
    });

    let warmed = 0;
    let skipped = 0;
    for (const wsId of workspaces) {
      const result = await step.run(`warm-${wsId}`, async () => {
        const summary = await weeklyReviewSummary(wsId, 7);
        if (summary.captures === 0 && summary.toolCalls === 0 && summary.tasksCompleted === 0) {
          return 'skipped';
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
        const cached = await getReviewNarrative(wsId, 7);
        if (cached && cached.inputsHash === inputsHash) return 'skipped';

        try {
          const { model, provider, modelId } = await getModel({
            workspaceId: wsId,
            intent: 'fast',
          });
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
              windowDays: 7,
              stats: {
                captures: summary.captures,
                toolCalls: summary.toolCalls,
                tasksCompleted: summary.tasksCompleted,
                projectsTouched: summary.projectsTouched,
                goalsActive: summary.goalsActive,
                goalsAchieved: summary.goalsAchieved,
              },
              topActivity: summary.topKinds,
              topProjects: summary.topProjects.map((p) => ({ name: p.name, events: p.events })),
            }),
            abortSignal: AbortSignal.timeout(30_000),
          });
          const narrative = text.trim();
          if (!narrative) return 'skipped';
          await upsertReviewNarrative({
            workspaceId: wsId,
            windowDays: 7,
            narrative,
            inputsHash,
            modelProvider: provider,
            modelId,
          });
          return 'warmed';
        } catch (err) {
          log.warn('review.narrative.prewarm_failed', {
            workspaceId: wsId,
            error: err instanceof Error ? err.message : String(err),
          });
          return 'skipped';
        }
      });
      if (result === 'warmed') warmed++;
      else skipped++;
    }

    return { ok: true, warmed, skipped };
  },
);
