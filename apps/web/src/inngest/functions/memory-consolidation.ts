/**
 * Nightly memory consolidation (Jarvis v3).
 *
 * Once per night, for each active workspace: read the day's raw memory
 * chunks (activity summaries, captures, learning statements) and distill
 * them into a handful of DURABLE insights — "what mattered today" facts
 * that survive long after raw OCR-adjacent chunks become noise:
 *   - episodic  → "worked on X, finished Y, got stuck on Z"
 *   - semantic  → stable facts learned about the user/projects
 *   - procedural→ workflows/habits worth remembering
 *
 * Insights are indexed back into memory (sourceKind 'decision',
 * metadata.origin 'consolidation', metadata.memoryType) so recall ranks
 * them alongside raw chunks. This is the standard episodic/semantic/
 * procedural pattern from the agent-memory literature, kept deliberately
 * minimal: one LLM call per active workspace per night.
 */
import { and, eq, gte, lt, desc, sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { getDb } from '@metu/db';
import { agentPolicy, memoryChunk } from '@metu/db/schema';
import { getModel } from '@metu/ai';
import { indexMemory } from '@metu/core/memory';
import { inngest } from '../client';

const MAX_INPUT_CHUNKS = 60;
const MAX_INPUT_CHARS = 16_000;

const SYSTEM = `You consolidate a user's day into durable memory. From the raw notes below (desktop activity summaries, captured text, stated preferences), extract 2-6 insights worth remembering long-term. Each insight on its own line, prefixed with its type:
EPISODIC: <what happened / state of work — concrete, names projects and files>
SEMANTIC: <stable fact learned about the user, their projects, or their tools>
PROCEDURAL: <a workflow, habit, or how-to worth reusing>
Only include genuinely durable insights — skip noise, skip anything that merely restates one raw note. If nothing is worth keeping, output exactly: NOTHING.`;

export const memoryConsolidation = inngest.createFunction(
  {
    id: 'memory-consolidation-nightly',
    name: 'Memory: nightly consolidation (episodic/semantic/procedural)',
    concurrency: { limit: 2 },
  },
  { cron: '30 2 * * *' }, // 02:30 UTC — quiet hours for the user base
  async ({ step }) => {
    const workspaces = await step.run('list-workspaces', async () => {
      const db = getDb();
      const rows = await db
        .select({ workspaceId: agentPolicy.workspaceId })
        .from(agentPolicy)
        .where(eq(agentPolicy.enabled, true));
      return rows.map((r) => r.workspaceId);
    });

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let consolidated = 0;

    for (const wsId of workspaces) {
      const inserted = await step.run(`consolidate-${wsId}`, async () => {
        const db = getDb();
        const rows = await db
          .select({ content: memoryChunk.content, metadata: memoryChunk.metadata })
          .from(memoryChunk)
          .where(and(eq(memoryChunk.workspaceId, wsId), gte(memoryChunk.createdAt, cutoff)))
          .orderBy(desc(memoryChunk.createdAt))
          .limit(MAX_INPUT_CHUNKS);

        // Skip already-consolidated outputs to avoid recursive distilling.
        const raw = rows.filter(
          (r) => (r.metadata as { origin?: string } | null)?.origin !== 'consolidation',
        );
        if (raw.length < 3) return 0; // not enough signal for a useful pass

        let body = '';
        for (const r of raw) {
          if (body.length + r.content.length > MAX_INPUT_CHARS) break;
          body += r.content + '\n---\n';
        }

        const { model } = await getModel({ workspaceId: wsId, intent: 'fast' });
        const { text } = await generateText({
          model: model as Parameters<typeof generateText>[0]['model'],
          system: SYSTEM,
          prompt: body,
          maxOutputTokens: 500,
        });
        if (!text.trim() || /^NOTHING\b/i.test(text.trim())) return 0;

        let count = 0;
        for (const line of text.split('\n')) {
          const m = /^(EPISODIC|SEMANTIC|PROCEDURAL):\s*(.{10,})$/.exec(line.trim());
          if (!m) continue;
          await indexMemory({
            workspaceId: wsId,
            sourceKind: 'decision',
            content: m[2]!.trim(),
            metadata: {
              origin: 'consolidation',
              memoryType: m[1]!.toLowerCase(),
              consolidatedAt: Date.now(),
            },
          });
          count++;
        }
        return count;
      });
      consolidated += inserted;
    }

    // Decay (Jarvis v3.1): raw ambient-activity chunks older than 14 days
    // are noise once their day has been consolidated — the insights carry
    // the signal. Purge them so recall stays sharp and the HNSW index
    // small. Only 'capture'-kind chunks from the companion distiller;
    // never preferences/continuity/insights.
    const decayed = await step.run('decay-raw-activity', async () => {
      const db = getDb();
      const cutoffOld = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const deleted = await db
        .delete(memoryChunk)
        .where(
          and(
            eq(memoryChunk.sourceKind, 'capture'),
            lt(memoryChunk.createdAt, cutoffOld),
            sql`${memoryChunk.metadata} ->> 'origin' = 'companion-activity'`,
          ),
        )
        .returning();
      return deleted.length;
    });

    return { workspaces: workspaces.length, insights: consolidated, decayed };
  },
);
