/**
 * Conductor planner — produce a structured plan from recent timeline events.
 *
 * Output is JSON-schema constrained so the Inngest function can act on it
 * without parsing prose. Each suggested action is a tool call with args; the
 * tick function pipes them through `runTool()` so the per-workspace ACL
 * enforces ask/auto/observe.
 */
import { generateObject } from 'ai';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { capture, integration, project, task, timelineEvent } from '@metu/db/schema';
import { buildConductorSystem, getModel } from '@metu/ai';
import { listTools } from './tools';

export const conductorPlanSchema = z.object({
  /** One-line synthesized state-of-the-world. Surfaced as the assistant heartbeat in the Conductor thread. */
  pulse: z.string().min(1).max(500),
  /** What to do next, ordered. The runner walks them top-down through the ACL. */
  actions: z
    .array(
      z.object({
        tool: z.string().describe('Tool name. Must be one of the registered tools.'),
        args: z
          .record(z.string(), z.unknown())
          .describe('Validated against the tool schema by the runner.'),
        why: z.string().min(1).max(280).describe('1 sentence: why this action now.'),
      }),
    )
    .max(5),
  /** Free-form notes, never shown to the user — kept in agent_run.metadata. */
  notes: z.string().optional(),
});

export type ConductorPlan = z.infer<typeof conductorPlanSchema>;

export interface PlanInput {
  workspaceId: string;
  reason?: string;
}

const LOOKBACK_HOURS = 6;

export async function planConductor(input: PlanInput): Promise<{
  plan: ConductorPlan;
  provider: string;
  modelId: string;
}> {
  const db = getDb();
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const [recentEvents, recentCaptures, projects, openTasks] = await Promise.all([
    db
      .select({
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        body: timelineEvent.body,
        importance: timelineEvent.importance,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(
        and(eq(timelineEvent.workspaceId, input.workspaceId), gte(timelineEvent.occurredAt, since)),
      )
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(40),
    db
      .select({
        id: capture.id,
        kind: capture.kind,
        content: capture.content,
        capturedAt: capture.capturedAt,
      })
      .from(capture)
      .where(and(eq(capture.workspaceId, input.workspaceId), gte(capture.capturedAt, since)))
      .orderBy(desc(capture.capturedAt))
      .limit(20),
    db
      .select({
        id: project.id,
        name: project.name,
        status: project.status,
        momentumScore: project.momentumScore,
        stateSummary: project.stateSummary,
      })
      .from(project)
      .where(eq(project.workspaceId, input.workspaceId))
      .orderBy(desc(project.momentumScore))
      .limit(10),
    db
      .select({
        id: task.id,
        title: task.title,
        status: task.status,
        leverageScore: task.leverageScore,
        projectId: task.projectId,
      })
      .from(task)
      .where(eq(task.workspaceId, input.workspaceId))
      .orderBy(desc(task.leverageScore))
      .limit(20),
  ]);

  const tools = listTools();

  // External MCP brains the user has connected. We surface their tool names
  // so the planner can intentionally call `external_invoke` instead of
  // hallucinating built-in equivalents.
  const externalRows = await db
    .select({ id: integration.id, label: integration.label, config: integration.config })
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, input.workspaceId),
        eq(integration.kind, 'external_mcp'),
        eq(integration.status, 'active'),
      ),
    )
    .limit(20);
  const externalBlock = externalRows
    .map((r) => {
      const cfg = (r.config ?? {}) as {
        toolPrefix?: string;
        lastTools?: Array<{ name: string; description?: string }>;
      };
      const list = (cfg.lastTools ?? [])
        .slice(0, 12)
        .map((t) => `      • ${t.name}${t.description ? ` — ${t.description.slice(0, 80)}` : ''}`)
        .join('\n');
      return `  - ${r.label} (id=${r.id}, prefix=${cfg.toolPrefix ?? '?'})${list ? `\n${list}` : ''}`;
    })
    .join('\n');

  const system = buildConductorSystem(`You are running a planning tick.

Your output is a JSON plan with:
  - pulse: a single-line state of the world (≤500 chars)
  - actions: ordered tool calls to take (max 5; can be empty)
  - notes: optional internal notes

Available tools (name · kind · description):
${tools.map((t) => `  - ${t.name} · ${t.kind} · ${t.description}`).join('\n')}
${externalBlock ? `\nConnected external second-brains (callable via \`external_invoke\` with integrationId + tool name):\n${externalBlock}\n` : ''}
Rules:
  - Prefer 0–2 actions. Doing nothing is often the right answer.
  - Use \`recall\` if you need grounding before suggesting changes.
  - Use \`log_observation\` to record meta-insights for later restore.
  - Use \`notify_user\` only for genuinely high-signal events.
  - Never suggest \`create_task\` for the same title twice — assume idempotency.
  - When the right answer lives in another connected brain (notai/mmo/etc.), call \`external_invoke\` with the integrationId above and a tool name from its list.
`);

  const userPrompt = JSON.stringify(
    {
      now: new Date().toISOString(),
      reason: input.reason ?? 'scheduled',
      lookbackHours: LOOKBACK_HOURS,
      projects,
      openTasks,
      recentEvents,
      recentCaptures: recentCaptures.map((c) => ({
        id: c.id,
        kind: c.kind,
        content: c.content?.slice(0, 400),
        capturedAt: c.capturedAt,
      })),
    },
    null,
    2,
  );

  const { model, provider, modelId } = await getModel({
    workspaceId: input.workspaceId,
    intent: 'agentic',
  });

  const { object } = await generateObject({
    model: model as Parameters<typeof generateObject>[0]['model'],
    system,
    schema: conductorPlanSchema,
    schemaName: 'ConductorPlan',
    schemaDescription:
      'Structured plan produced by the Conductor on each tick. Pulse + ordered action list + notes.',
    prompt: userPrompt,
    // The model occasionally returns a "briefing/suggestedActions/questions"
    // shape (a sibling planner schema). Coerce it back to the canonical
    // pulse/actions shape so the tick doesn't fail and waste a cycle.
    experimental_repairText: async ({ text }) => {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !('pulse' in parsed)) {
          const briefing =
            (parsed.briefing as string | undefined) ??
            (parsed.summary as string | undefined) ??
            (parsed.state as string | undefined);
          if (briefing) {
            const followups = [
              Array.isArray(parsed.suggestedActions) && parsed.suggestedActions.length
                ? `suggested: ${(parsed.suggestedActions as unknown[]).join(' | ')}`
                : null,
              Array.isArray(parsed.questions) && parsed.questions.length
                ? `questions: ${(parsed.questions as unknown[]).join(' | ')}`
                : null,
            ]
              .filter(Boolean)
              .join('\n');
            const repaired = {
              pulse: String(briefing).slice(0, 500),
              actions: Array.isArray(parsed.actions) ? parsed.actions : [],
              notes: (parsed.notes as string | undefined) ?? (followups || undefined),
            };
            return JSON.stringify(repaired);
          }
        }
      } catch {
        // fall through — let the SDK throw the original error.
      }
      return null;
    },
  });

  return { plan: object, provider, modelId };
}
