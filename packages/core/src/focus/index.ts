/**
 * Focus Engine — strategic prioritizer.
 *
 * Pulls active projects + open tasks + recent captures + energy log,
 * asks the LLM to produce ONE current task, ≤3 next, ≥1 explicit ignore.
 * Output is JSON-schema constrained (Zod).
 */
import { generateObject } from 'ai';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { energyLog, focusState, project, task, timelineEvent } from '@metu/db/schema';
import { focusOutputSchema, type FocusOutput } from '@metu/types';
import { getModel, FOCUS_ENGINE_SYSTEM } from '@metu/ai';

export interface ComputeFocusInput {
  workspaceId: string;
  userId: string;
}

export interface ComputeFocusResult {
  output: FocusOutput;
  provider: string;
  modelId: string;
  rowId: string;
}

export async function computeFocus(input: ComputeFocusInput): Promise<ComputeFocusResult> {
  const db = getDb();
  const { workspaceId, userId } = input;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [activeProjects, openTasks, recentEnergy, recentEvents] = await Promise.all([
    db
      .select({
        id: project.id,
        name: project.name,
        summary: project.summary,
        stateSummary: project.stateSummary,
        momentumScore: project.momentumScore,
        lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
        status: project.status,
      })
      .from(project)
      .where(
        and(
          eq(project.workspaceId, workspaceId),
          isNull(project.deletedAt),
          sql`${project.status} in ('active','paused')`,
        ),
      )
      .orderBy(desc(project.momentumScore)),
    db
      .select({
        id: task.id,
        projectId: task.projectId,
        title: task.title,
        body: task.body,
        status: task.status,
        kind: task.kind,
        leverageScore: task.leverageScore,
        blockedReason: task.blockedReason,
      })
      .from(task)
      .where(
        and(
          eq(task.workspaceId, workspaceId),
          isNull(task.deletedAt),
          sql`${task.status} not in ('done','dropped')`,
        ),
      )
      .limit(60),
    db
      .select({ energy: energyLog.energy, mood: energyLog.mood, loggedAt: energyLog.loggedAt })
      .from(energyLog)
      .where(and(eq(energyLog.userId, userId), gte(energyLog.loggedAt, fourteenDaysAgo)))
      .orderBy(desc(energyLog.loggedAt))
      .limit(5),
    db
      .select({
        kind: timelineEvent.kind,
        title: timelineEvent.title,
        projectId: timelineEvent.projectId,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          gte(timelineEvent.occurredAt, fourteenDaysAgo),
        ),
      )
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(40),
  ]);

  const currentEnergy = recentEnergy[0]?.energy ?? 3;

  const prompt = JSON.stringify(
    {
      now: new Date().toISOString(),
      energyLevel: currentEnergy,
      projects: activeProjects.map((p) => ({
        id: p.id,
        name: p.name,
        summary: p.summary,
        pulse: p.stateSummary,
        momentum: p.momentumScore,
        lastActivity: p.lastMeaningfulActivityAt,
        status: p.status,
      })),
      openTasks: openTasks.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        title: t.title,
        body: t.body?.slice(0, 400),
        status: t.status,
        kind: t.kind,
        leverage: t.leverageScore,
        blockedReason: t.blockedReason,
      })),
      recentEvents: recentEvents.map((e) => ({
        kind: e.kind,
        title: e.title,
        projectId: e.projectId,
        at: e.occurredAt,
      })),
    },
    null,
    2,
  );

  const { model, provider, modelId } = await getModel({
    workspaceId,
    intent: 'reasoning',
  });

  console.info('[focus.compute] generateObject', {
    workspaceId,
    provider,
    modelId,
    promptBytes: prompt.length,
    projects: activeProjects.length,
    openTasks: openTasks.length,
    events: recentEvents.length,
  });

  let object: FocusOutput;
  try {
    const result = await generateObject({
      model: model as Parameters<typeof generateObject>[0]['model'],
      system: FOCUS_ENGINE_SYSTEM,
      schema: focusOutputSchema,
      schemaName: 'FocusOutput',
      schemaDescription:
        'The single current task, up to 3 next tasks, projects to ignore this week, and a short rationale.',
      // Some providers (e.g. Copilot's Anthropic proxy) ignore the
      // `response_format: json_schema` request and return prose. Repair the
      // text by extracting the first JSON object/array we can find.
      experimental_repairText: async ({ text }) => {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenced && fenced[1]) return fenced[1].trim();
        const start = text.search(/[{[]/);
        if (start === -1) return null;
        // Find the matching closing brace by depth-tracking.
        const open = text[start];
        const close = open === '{' ? '}' : ']';
        let depth = 0;
        let inStr = false;
        let escape = false;
        for (let i = start; i < text.length; i++) {
          const c = text[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (c === '\\') {
            escape = true;
            continue;
          }
          if (c === '"') {
            inStr = !inStr;
            continue;
          }
          if (inStr) continue;
          if (c === open) depth++;
          else if (c === close) {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
          }
        }
        return null;
      },
      prompt: [
        'Respond with ONLY a single JSON object that matches the schema below.',
        'No prose, no markdown, no commentary, no code fences. JSON only.',
        '',
        'JSON Schema:',
        JSON.stringify(z.toJSONSchema(focusOutputSchema), null, 2),
        '',
        'Required shape (structure only — replace placeholders with real values):',
        JSON.stringify(
          {
            now: { taskId: null, title: '<single task>', why: '<one sentence>' },
            next: [{ taskId: null, title: '<task>', why: '<reason>' }],
            ignoreThisWeek: [
              {
                projectId: '00000000-0000-0000-0000-000000000000',
                name: '<project>',
                reason: '<why ignore>',
              },
            ],
            rationale: '<20-2000 chars explaining the ranking and tradeoffs>',
          },
          null,
          2,
        ),
        '',
        'If the workspace is empty (no projects, no tasks), still return the shape with sensible placeholders. ignoreThisWeek must contain at least one entry — use projectId "00000000-0000-0000-0000-000000000000" and name "none" if the workspace is empty.',
        '',
        'Context:',
        prompt,
      ].join('\n'),
    });
    object = result.object;
  } catch (err) {
    // The AI SDK throws e.g. NoObjectGeneratedError / AI_TypeValidationError
    // with the raw model text on `.text`. Surface it so we can see *why* the
    // model returned invalid JSON instead of a generic "Invalid JSON response".
    const e = err as Error & {
      name?: string;
      cause?: unknown;
      text?: string;
      response?: { body?: unknown };
      finishReason?: string;
      usage?: unknown;
    };
    console.error('[focus.compute] generateObject failed', {
      provider,
      modelId,
      name: e?.name,
      message: e?.message,
      finishReason: e?.finishReason,
      usage: e?.usage,
      text: typeof e?.text === 'string' ? e.text.slice(0, 4000) : undefined,
      cause:
        e?.cause instanceof Error ? { name: e.cause.name, message: e.cause.message } : e?.cause,
    });
    throw new Error(
      `Focus model (${provider}/${modelId}) returned invalid output: ${e?.message ?? 'unknown'}`,
      { cause: err },
    );
  }

  const [row] = await db
    .insert(focusState)
    .values({
      workspaceId,
      userId,
      nowTaskId: object.now.taskId ?? null,
      nextTaskIds: object.next.map((n) => n.taskId).filter(Boolean) as string[],
      ignoredProjectIds: object.ignoreThisWeek.map((i) => i.projectId),
      rationale: object.rationale,
      energyLevel: currentEnergy,
    })
    .returning();

  return {
    output: object,
    provider,
    modelId,
    rowId: row!.id,
  };
}

export async function getLatestFocus(workspaceId: string, userId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(focusState)
    .where(and(eq(focusState.workspaceId, workspaceId), eq(focusState.userId, userId)))
    .orderBy(desc(focusState.computedAt))
    .limit(1);
  return row ?? null;
}
