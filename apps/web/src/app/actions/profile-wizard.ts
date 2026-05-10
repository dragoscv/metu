'use server';
/**
 * Profile Wizard — AI-driven contextual Q&A that learns about the user.
 *
 * Storage model (no new table):
 *   - Each answer indexed into `memory_chunk` with sourceKind='manual' and
 *     metadata.tag='profile'. Chunks are recalled later by other agents.
 *   - Mirrored into `timeline_event` (kind='profile.answer') for audit + UI.
 *
 * The "next question" generator pulls existing profile chunks + workspace
 * signals (projects, goals, integrations, recent timeline kinds) and asks the
 * agentic model to produce ONE non-redundant question with optional choices.
 */
import { revalidatePath } from 'next/cache';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { log } from '@/lib/logger';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { goal, integration, memoryChunk, project, timelineEvent } from '@metu/db/schema';
import { generateStructured, getModel } from '@metu/ai';
import { memory } from '@metu/core';

// ---------------------------------------------------------------------------
// Schemas (LLM output + action inputs)
// ---------------------------------------------------------------------------

// Choices can come from the model in two natural shapes:
//   `["A","B","C"]`  — flat strings
//   `[{label,value}]` — structured
// Accept both via z.union, then normalize below.
const choiceItemSchema = z.union([
  z.string().min(1).max(120),
  z.object({
    label: z.string().min(1).max(120),
    value: z.string().min(1).max(120).optional(),
  }),
]);

const profileQuestionSchema = z.object({
  topic: z
    .string()
    .min(1)
    .max(60)
    .describe(
      'Short topic label (kebab-case): role, values, workstyle, focus, blockers, tools, schedule, communication, learning-goals, life-context, etc.',
    ),
  question: z
    .string()
    .min(5)
    .max(400)
    .describe('The question to ask the user. Warm, conversational, second-person.'),
  kind: z
    .string()
    .optional()
    .describe(
      'One of: "free_text", "multiple_choice", "multi_with_freeform". free_text = open-ended only; multiple_choice = pick from given options; multi_with_freeform = pick options AND/OR write your own.',
    ),
  choices: z
    .array(choiceItemSchema)
    .max(8)
    .optional()
    .describe(
      'Array of 2-6 choices for multiple_choice / multi_with_freeform. Each item is an object {label, value}. Omit for free_text.',
    ),
  allowMultiSelect: z
    .boolean()
    .optional()
    .describe('When the question has choices, can the user select more than one?'),
  rationale: z
    .string()
    .max(240)
    .optional()
    .describe('Why this question now (internal — not shown to the user).'),
});

type RawProfileQuestion = z.infer<typeof profileQuestionSchema>;

// Public shape the UI consumes (after normalization).
export interface ProfileQuestion {
  topic: string;
  question: string;
  kind: 'free_text' | 'multiple_choice' | 'multi_with_freeform';
  choices?: { label: string; value: string }[];
  allowMultiSelect: boolean;
  rationale?: string;
}

function normalizeQuestion(raw: RawProfileQuestion): ProfileQuestion {
  const choices = (raw.choices ?? []).map((c) => {
    if (typeof c === 'string') return { label: c, value: c };
    return { label: c.label, value: c.value ?? c.label };
  });
  const k = String(raw.kind ?? '')
    .toLowerCase()
    .replace(/[^a-z_]/g, '');
  const allowed = new Set(['free_text', 'multiple_choice', 'multi_with_freeform']);
  let kind: ProfileQuestion['kind'];
  if (allowed.has(k)) {
    kind = k as ProfileQuestion['kind'];
  } else if (choices.length >= 2) {
    kind = 'multi_with_freeform';
  } else {
    kind = 'free_text';
  }
  // When the model offered choices, ALWAYS allow freeform too — the user
  // should never be forced into a predefined answer if none fit. We only
  // honor pure 'multiple_choice' (chips-only, no textarea) if the model
  // explicitly asked for it AND choices exist.
  if (choices.length >= 2 && kind === 'multiple_choice') {
    kind = 'multi_with_freeform';
  }
  // Final guard: kind says choices but none came back → free_text.
  if ((kind === 'multiple_choice' || kind === 'multi_with_freeform') && choices.length < 2) {
    kind = 'free_text';
  }
  return {
    topic: raw.topic,
    question: raw.question,
    kind,
    choices: choices.length > 0 ? choices : undefined,
    allowMultiSelect: raw.allowMultiSelect ?? false,
    rationale: raw.rationale,
  };
}

const submitAnswerSchema = z.object({
  topic: z.string().min(1).max(60),
  question: z.string().min(1).max(500),
  kind: z.enum(['free_text', 'multiple_choice', 'multi_with_freeform']),
  selectedChoices: z.array(z.string().max(120)).max(8).default([]),
  freeformAnswer: z.string().max(2000).default(''),
});

const skipQuestionSchema = z.object({
  topic: z.string().min(1).max(60),
  question: z.string().min(1).max(500),
  reason: z.string().max(240).default(''),
});

// ---------------------------------------------------------------------------
// State for the wizard page (counts + recent facts)
// ---------------------------------------------------------------------------

export interface ProfileFact {
  id: string;
  topic: string;
  content: string;
  createdAt: string;
}

export async function getProfileWizardStateAction(): Promise<
  { ok: true; factCount: number; facts: ProfileFact[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const db = getDb();
  const wsId = session.user.workspaceId;

  const rows = await db
    .select({
      id: memoryChunk.id,
      content: memoryChunk.content,
      metadata: memoryChunk.metadata,
      createdAt: memoryChunk.createdAt,
    })
    .from(memoryChunk)
    .where(
      and(
        eq(memoryChunk.workspaceId, wsId),
        eq(memoryChunk.sourceKind, 'manual'),
        sql`${memoryChunk.metadata} ->> 'tag' = 'profile'`,
      ),
    )
    .orderBy(desc(memoryChunk.createdAt))
    .limit(40);

  const facts: ProfileFact[] = rows.map((r) => {
    const meta = (r.metadata ?? {}) as { topic?: string };
    return {
      id: r.id,
      topic: meta.topic ?? 'general',
      content: r.content,
      createdAt: r.createdAt.toISOString(),
    };
  });

  return { ok: true, factCount: facts.length, facts };
}

// ---------------------------------------------------------------------------
// Generate next question
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are METU's onboarding companion. Your only job is to learn about the user so the rest of the system can personalize their experience.

You ask exactly ONE thoughtful question per call. Behave like a curious, warm coach — never a survey form.

Rules:
  - Look at TOPICS_ALREADY_COVERED. Do not ask about the same topic twice unless you are deepening it with a clearly different angle.
  - Mix breadth and depth. Early on prefer high-level identity questions (role, values, working style, current life chapter). Later, drill into specifics (current focus, blockers, tools, recurring frustrations, ideal next quarter).
  - When the user has projects/goals/integrations connected, prefer questions that reference them concretely.
  - **You MUST include 3–5 quick-pick choices on EVERY question and set kind = "multi_with_freeform".** The user almost always wants to tap a chip rather than type. The freeform textarea is automatic — they can still type if no chip fits. Never return a question with zero choices, even for open-ended ones; in that case offer 3–5 representative example answers as chips.
  - Choices must be SPECIFIC, mutually meaningful, and distinct — never "Yes / No / Maybe". Example good set for "How do you prefer to start your day?": ["Deep work first thing", "Quick wins to build momentum", "Inbox / messages first", "Plan & prioritize", "Slow ramp / coffee + reading"].
  - Each choice label ≤ 60 chars. Aim for 3–5 choices (max 6).
  - Set allowMultiSelect = true when 2+ options can genuinely both apply (e.g. tools used, motivations, frustrations). Set false when the answer is naturally single-pick (e.g. preferred working time of day).
  - Keep the question under 200 characters. Plain language. No corporate-speak.
  - When you suggest multi-select, mention it lightly in the question phrasing (e.g. "Pick any that fit").
  - Never invent facts. If context is thin, ask broad identity questions first.
`;

export async function generateNextProfileQuestionAction(args?: {
  /** Topics the user just answered or skipped this session — try to avoid them. */
  recentTopics?: string[];
}): Promise<{ ok: true; question: ProfileQuestion } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;
  const db = getDb();

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const [profileRows, projects, goals, integrations, recentEventKinds] = await Promise.all([
    db
      .select({
        content: memoryChunk.content,
        metadata: memoryChunk.metadata,
        createdAt: memoryChunk.createdAt,
      })
      .from(memoryChunk)
      .where(
        and(
          eq(memoryChunk.workspaceId, wsId),
          eq(memoryChunk.sourceKind, 'manual'),
          sql`${memoryChunk.metadata} ->> 'tag' = 'profile'`,
        ),
      )
      .orderBy(desc(memoryChunk.createdAt))
      .limit(30),
    db
      .select({ name: project.name, status: project.status })
      .from(project)
      .where(eq(project.workspaceId, wsId))
      .orderBy(desc(project.momentumScore))
      .limit(8),
    db
      .select({ title: goal.title, status: goal.status, cadence: goal.cadence })
      .from(goal)
      .where(eq(goal.workspaceId, wsId))
      .orderBy(desc(goal.weight))
      .limit(8),
    db
      .select({ kind: integration.kind, label: integration.label })
      .from(integration)
      .where(and(eq(integration.workspaceId, wsId), eq(integration.status, 'active')))
      .limit(20),
    db
      .select({
        kind: timelineEvent.kind,
        count: sql<number>`count(*)::int`,
      })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, wsId), gte(timelineEvent.occurredAt, since)))
      .groupBy(timelineEvent.kind)
      .orderBy(desc(sql`count(*)`))
      .limit(10),
  ]);

  const topicsAlreadyCovered = Array.from(
    new Set(
      profileRows
        .map((r) => ((r.metadata ?? {}) as { topic?: string }).topic ?? null)
        .filter((t): t is string => !!t),
    ),
  );

  const recentlyAsked = (args?.recentTopics ?? []).slice(-6);

  const userPrompt = JSON.stringify(
    {
      now: new Date().toISOString(),
      identity: {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      },
      profileFactsSoFar: profileRows.map((r) => ({
        topic: ((r.metadata ?? {}) as { topic?: string }).topic ?? 'general',
        content: r.content.slice(0, 240),
      })),
      topicsAlreadyCovered,
      recentlyAskedThisSession: recentlyAsked,
      workspaceSignals: {
        projects: projects.map((p) => ({ name: p.name, status: p.status })),
        goals: goals.map((g) => ({ title: g.title, status: g.status, cadence: g.cadence })),
        connectedIntegrations: integrations.map((i) => ({
          kind: i.kind,
          label: i.label,
        })),
        recentActivityKinds: recentEventKinds,
      },
    },
    null,
    2,
  );

  try {
    const { model } = await getModel({ workspaceId: wsId, intent: 'agentic' });
    const gen = async (extra?: string) =>
      generateStructured({
        model,
        system: extra ? `${SYSTEM_PROMPT}\n\n${extra}` : SYSTEM_PROMPT,
        schema: profileQuestionSchema,
        schemaName: 'ProfileQuestion',
        schemaDescription: 'A single contextual profile-discovery question.',
        prompt: userPrompt,
      });

    const { object } = await gen();
    let normalized = normalizeQuestion(object);

    // Quick-pick chips are part of the product contract. If the model skipped
    // choices, retry once with an explicit reminder.
    if (!normalized.choices || normalized.choices.length < 3) {
      try {
        const retry = await gen(
          'CRITICAL: your previous attempt did not include choices. You MUST return 3–5 quick-pick choices and set kind = "multi_with_freeform". Do not return free_text.',
        );
        const retryNorm = normalizeQuestion(retry.object);
        if ((retryNorm.choices?.length ?? 0) >= 3) {
          normalized = retryNorm;
        }
      } catch {
        // ignore — chip fallback below will still try
      }
    }

    // Final safety net: dedicated chips-only call. Much simpler task than
    // generating the full question, so it almost always succeeds even when
    // the structured-output negotiation flaked above.
    if (!normalized.choices || normalized.choices.length < 3) {
      try {
        const chipsSchema = z.object({
          choices: z
            .array(z.string().min(1).max(80))
            .min(2)
            .max(8)
            .describe('3–5 short, specific, distinct chip labels.'),
          allowMultiSelect: z.boolean().optional(),
        });
        const chipsRes = await generateStructured({
          model,
          system:
            'You generate 3–5 short, specific, mutually-distinct quick-pick option labels for a single survey-style question. Each label ≤ 60 chars. No "Yes/No/Maybe". Return JSON of shape {"choices": ["…","…","…"], "allowMultiSelect": true|false}.',
          schema: chipsSchema,
          schemaName: 'ChipOptions',
          prompt: `Question: "${normalized.question}"\nTopic: ${normalized.topic}\n\nReturn 3–5 plausible answer chips a real person might tap. Set allowMultiSelect = true if multiple can apply (e.g. tools, motivations); false otherwise.`,
        });
        const chips = chipsRes.object.choices
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 6)
          .map((s) => ({ label: s, value: s }));
        if (chips.length >= 2) {
          normalized = {
            ...normalized,
            kind: 'multi_with_freeform',
            choices: chips,
            allowMultiSelect: chipsRes.object.allowMultiSelect ?? normalized.allowMultiSelect,
          };
        } else {
          log.warn('profile_wizard.chips.fallback_short', { chips });
        }
      } catch (chipErr) {
        log.warn('profile_wizard.chips.fallback_failed', {
          message: chipErr instanceof Error ? chipErr.message : String(chipErr),
        });
      }
    }

    return { ok: true, question: normalized };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to generate question',
    };
  }
}

// ---------------------------------------------------------------------------
// Submit answer
// ---------------------------------------------------------------------------

export async function submitProfileAnswerAction(
  input: z.infer<typeof submitAnswerSchema>,
): Promise<{ ok: true; factId: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };

  const parsed = submitAnswerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { topic, question, kind, selectedChoices, freeformAnswer } = parsed.data;

  const parts: string[] = [];
  if (selectedChoices.length > 0) parts.push(selectedChoices.join('; '));
  if (freeformAnswer.trim().length > 0) parts.push(freeformAnswer.trim());
  const answerText = parts.join(' — ');
  if (!answerText) return { ok: false, error: 'Empty answer' };

  const wsId = session.user.workspaceId;
  const db = getDb();
  const now = new Date();

  // 1) Insert timeline event (gets us a stable id to anchor the memory chunk).
  const [event] = await db
    .insert(timelineEvent)
    .values({
      workspaceId: wsId,
      userId: session.user.id,
      kind: 'profile.answer',
      title: question.length > 120 ? `${question.slice(0, 117)}…` : question,
      body: answerText,
      payload: {
        topic,
        question,
        kind,
        selectedChoices,
        freeformAnswer,
      },
      importance: 0.6,
      occurredAt: now,
    })
    .returning();

  if (!event) return { ok: false, error: 'Failed to record answer' };

  // 2) Index into memory so other agents can recall it.
  const content = `[profile:${topic}] Q: ${question}\nA: ${answerText}`;
  try {
    await memory.indexMemory({
      workspaceId: wsId,
      sourceKind: 'manual',
      sourceId: event.id,
      content,
      metadata: {
        tag: 'profile',
        topic,
        question,
        questionKind: kind,
        selectedChoices,
        hasFreeform: freeformAnswer.trim().length > 0,
        wizardVersion: 1,
        answeredAt: now.toISOString(),
      },
    });
  } catch (err) {
    // Non-fatal: timeline event still recorded. Surface the issue to caller.
    return {
      ok: false,
      error: `Saved to timeline but failed to embed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  revalidatePath('/about-me');
  return { ok: true, factId: event.id };
}

// ---------------------------------------------------------------------------
// Skip question (records lightweight signal, no memory write)
// ---------------------------------------------------------------------------

export async function skipProfileQuestionAction(
  input: z.infer<typeof skipQuestionSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = skipQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const db = getDb();
  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    kind: 'profile.skipped',
    title: parsed.data.question.slice(0, 117),
    body: parsed.data.reason || null,
    payload: { topic: parsed.data.topic, question: parsed.data.question },
    importance: 0.2,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Delete a fact (let the user prune what was learned)
// ---------------------------------------------------------------------------

const deleteFactSchema = z.object({ id: z.string().uuid() });

export async function deleteProfileFactAction(
  input: z.infer<typeof deleteFactSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const parsed = deleteFactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid id' };
  const db = getDb();
  await db
    .delete(memoryChunk)
    .where(
      and(
        eq(memoryChunk.id, parsed.data.id),
        eq(memoryChunk.workspaceId, session.user.workspaceId),
        eq(memoryChunk.sourceKind, 'manual'),
      ),
    );
  revalidatePath('/about-me');
  return { ok: true };
}
