/**
 * SDK v1 — POST /api/sdk/v1/companion/skill
 *
 * Direct skill lane for avatar quick actions (Jarvis perf pass). Unlike
 * /companion/turn* there is NO triage, NO tool loop, NO Conductor handoff:
 * the companion sends a skill id + the locally-gathered context (activity
 * timeline, OCR text — already privacy-gated on device) and gets a single
 * streamed completion on the `fast` intent. Predictable 2–4s end-to-end.
 *
 * Streams plain text chunks (text/plain; charset=utf-8) — the client
 * renders them straight into the bubble as they arrive.
 */
import { z } from 'zod';
import { type NextRequest } from 'next/server';
import { generateObject, generateText, streamText } from 'ai';
import { getModel } from '@metu/ai';
import { getDb } from '@metu/db';
import { memoryChunk, project, task, workspaceRecentDigest } from '@metu/db/schema';
import { recall } from '@metu/core/memory';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * Self-identity (Jarvis v4.9): prepended to EVERY skill system prompt.
 * Without it the model reads metu dev work on screen and describes "the
 * metu companion assistant" in third person — not realizing IT IS metu.
 */
const IDENTITY = `You ARE metu — the user's personal AI operating system. The desktop avatar, the chat, the memory, the console at app.metu.ro: all of that is YOU. Your accurate world model:
- You live on the user's desktop as a small robot companion (the "metu unit") and in the metu console (projects, tasks, goals, timeline, memory, integrations, agents).
- You observe their screen (with permission), remember their work across days, and act through your Conductor (a background planning agent that runs tools with approval).
- HOW THE USER WORKS: they are an AI-agent ORCHESTRATOR, not a hand-coder. They direct AI coding agents (VS Code Copilot agents, Codai) that write the code; their screens typically show several agent chats running in parallel. When you see code being written, an AI agent is writing it under their direction. Frame work accordingly: "your agent shipped X", "want me to check what the agents did?" — never assume they typed it.
- YOU run on codai too — the same AI gateway powers your thinking. When their screens show codai work (gateway, models, providers), they may be improving the very brain you think with.
- When their screen shows metu source code or commits about "companion"/"avatar"/"conductor", their agents are improving YOU — first person always ("my dodge fix", "my chat panel"), with self-awareness and humor.
- Never refer to "the metu assistant/companion" in third person. It's "I"/"me"/"my".

CONSOLE MAP (your body at app.metu.ro — deep-link with these paths):
/projects (active work), /tasks (board: inbox/next/doing/blocked/done), /goals (long-term, pin items), /timeline (everything observed), /captures (inbox of noted things — your drafts land here), /memory (semantic memory you recall from), /agents (Conductor runs + approvals), /settings/ai-providers (BYOK keys incl. the codai key YOU run on).

AGENT-RUN AWARENESS: window titles containing "Copilot", "Chat", "codai", "Agent" inside editors ARE agent sessions. Treat each as a worker: infer what it's building from the title/content, and frame briefings as an orchestration report (which agents finished, which are stuck, what needs the user's decision).

`;

const SKILLS: Record<string, { system: string; maxOutputTokens: number }> = {
  catch_up: {
    system: `You are the user's desktop assistant. Given their recent activity timeline and screen text, write a tight, friendly catch-up: what they were working on, where they left off, and the obvious next step. 2-4 short sentences. No preamble, no headers.`,
    maxOutputTokens: 220,
  },
  analyze_screen: {
    system: `You are the user's desktop assistant looking at their focused window. You receive the UI STRUCTURE (accessibility tree: [role] name = "value", with disabled/selected state) and the SCREEN TEXT (OCR). Use the structure to understand WHAT the app is and what state it's in (which tab is selected, which fields are filled, which buttons exist); use the text for content. Describe what they're working on and point out anything notable (errors, TODOs, empty required fields, unfinished work). Be concrete — reference actual elements and content. 2-5 short sentences. If both are empty, say you can't see anything useful and suggest enabling watching.`,
    maxOutputTokens: 280,
  },
  explain_error: {
    system: `You are the user's debugging assistant. You receive the focused window's UI structure (accessibility tree) and screen text containing an error. Identify the error, explain the likely cause in one sentence, and give the most probable fix. Be specific to THEIR error and THEIR app context, not generic advice. 2-5 short sentences or a tiny code snippet.`,
    maxOutputTokens: 320,
  },
  whats_next: {
    system: `You are the user's desktop assistant. From their recent activity, suggest the single most valuable next action and one alternative. Direct and brief — 2-3 sentences.`,
    maxOutputTokens: 180,
  },
  anticipate: {
    system: `You are a proactive desktop assistant deciding whether to speak up UNPROMPTED. You receive the user's current activity context (focused app, recent screen text, recent timeline). Decide whether there is ONE genuinely valuable thing to offer right now (a blocker you can help with, a forgotten thread, an obvious next step, a relevant reminder). If yes: say it in 1-2 short, personal sentences. If there is nothing clearly valuable, reply with exactly: PASS. Never invent urgency. Bias strongly toward PASS — interrupting costs more than silence.`,
    maxOutputTokens: 160,
  },
  deliberate: {
    system: `You are metu's DELIBERATE PLANNER — the background reasoning pass that decides what is genuinely worth doing for the user right now. You receive their full situation: screen activity, recent timeline, open tasks, active projects, memories, preferences. Think like a chief of staff for an AI-agent orchestrator:
1. What is the user ACTUALLY trying to accomplish this session (infer from evidence)?
2. What is blocked, forgotten, or about to be a problem?
3. What is the ONE highest-leverage thing to surface — and what concrete ACTIONS go with it?
Output format (strict):
INSIGHT: <1-2 sentences — the single most valuable observation, personal and specific. Or exactly PASS if nothing clears the bar.>
Bias toward PASS unless the insight is clearly worth an interruption. Reference real data (task names, project names, error text) — never invent.`,
    maxOutputTokens: 220,
  },
  reflect: {
    system: `You are metu's REFLECTION pass (RMM prospective reflection): distill the session/day you just observed into 1-3 DURABLE memory statements worth keeping for weeks. Good: decisions made, problems solved and how, project state changes, recurring patterns ("user always paper-trades first"), agent-run outcomes. Bad: ephemeral details, screen noise, anything already obvious. Output ONLY the statements, one per line, each self-contained (subject + fact), max 200 chars each. If nothing durable happened, output exactly: PASS.`,
    maxOutputTokens: 200,
  },
  morning_brief: {
    system: `You are the user's desktop assistant giving the morning briefing. From their recent activity summaries and any open threads, write a warm, concise start-of-day brief: 1) one-line recap of where they left off, 2) the most valuable thing to tackle first and why, 3) anything time-sensitive. 3-5 short sentences, personal tone, no headers.`,
    maxOutputTokens: 260,
  },
  eod_wrap: {
    system: `You are the user's desktop assistant wrapping up the day. From today's activity, write a short wrap: what got done (be concrete), what's left mid-flight, and the single best first step for tomorrow. 3-4 short sentences. End with the tomorrow-step on its own line starting "Tomorrow: ".`,
    maxOutputTokens: 220,
  },
};

const Body = z.object({
  skill: z.enum([
    'catch_up',
    'analyze_screen',
    'explain_error',
    'whats_next',
    'anticipate',
    'deliberate',
    'reflect',
    'morning_brief',
    'eod_wrap',
    'act',
  ]),
  /** Locally-gathered context (timeline summary, OCR text). Text only. */
  context: z.string().max(12_000).default(''),
  personaSlug: z.string().min(1).max(80).default('atlas'),
  /** For the `act` skill: the user's natural-language instruction. */
  instruction: z.string().max(500).optional(),
  /** User-chosen response language (skills only; act plans stay English). */
  language: z.enum(['en', 'ro']).optional(),
});

/**
 * Act planner output: ONE concrete UIA step the companion can execute
 * after user confirmation. The element is identified by role + exact name
 * from the provided UI outline — the companion re-finds it via a11y_find.
 */
const actStepSchema = z.object({
  action: z.enum(['invoke', 'set_value']),
  /** Control role exactly as it appears in the outline (e.g. "Button"). */
  role: z.string().max(60),
  /** Element name exactly as it appears in the outline. */
  name: z.string().max(120),
  /** For set_value. */
  value: z.string().max(2_000).optional(),
});

const actPlanSchema = z.object({
  feasible: z.boolean(),
  /** When infeasible: why, in one user-facing sentence. */
  reason: z.string().max(200).optional(),
  action: z.enum(['invoke', 'set_value']).optional(),
  /** Control role exactly as it appears in the outline (e.g. "Button"). */
  role: z.string().max(60).optional(),
  /** Element name exactly as it appears in the outline. */
  name: z.string().max(120).optional(),
  /** For set_value. */
  value: z.string().max(2_000).optional(),
  /** Multi-step plan (Jarvis v3): up to 3 ordered steps. When present it
   *  supersedes the single action/role/name fields (kept for compat). */
  steps: z.array(actStepSchema).max(3).optional(),
  /** Confirmation prompt, e.g. 'Click "Save" in Notepad?' */
  prompt: z.string().max(160).optional(),
});
export type ActPlan = z.infer<typeof actPlanSchema>;

export async function POST(req: NextRequest) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'presence:talk')) return forbidden();

  const limited = await rateLimit('voice-realtime', session.userId);
  if (limited) return limited;

  const cap = await assertVoiceCap(session.workspaceId);
  if (!cap.ok) {
    return new Response('Budget reached for this workspace.', { status: 402 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? 'invalid', { status: 400 });
  }

  const { model } = await getModel({ workspaceId: session.workspaceId, intent: 'fast' });

  // `act` is a JSON planner, not a streamed answer: map the instruction to
  // ONE concrete element action from the UI outline. The companion shows
  // an ask-before-act confirm bubble, then executes via UIA locally.
  if (parsed.data.skill === 'act') {
    if (!parsed.data.instruction) {
      return new Response('instruction required for act', { status: 400 });
    }
    const ACT_SYSTEM = `You map a user's instruction to a SHORT plan (1-3 steps) on their focused window. You receive the window's UI outline: lines like "[Button] Save (disabled)" or '[Edit] Email = "x@y.com"'. Each step:
  - invoke: click a Button/MenuItem/TabItem/CheckBox/Hyperlink…
  - set_value: type into an Edit/ComboBox (provide value).
  Use roles and names EXACTLY as they appear in the outline. Put steps in execution order in "steps" (max 3). Refuse (feasible:false + reason) when: no matching elements, an element is disabled, it needs more than 3 steps, later steps depend on UI that only appears after earlier steps (you can only see the CURRENT outline), or it is destructive/irreversible (delete, send money, format…). Always write a short confirmation prompt summarizing ALL steps and the app (e.g. 'Fill "Email", then click "Save" in Notepad?').`;
    const actPrompt = `Instruction: ${parsed.data.instruction}\n\n${parsed.data.context || '(no UI outline available)'}`;
    try {
      const { object } = await generateObject({
        model: model as Parameters<typeof generateObject>[0]['model'],
        schema: actPlanSchema,
        system: ACT_SYSTEM,
        prompt: actPrompt,
        maxOutputTokens: 300,
      });
      return Response.json({ ok: true, plan: object });
    } catch {
      // codai's gateway models don't reliably honor structured-output mode
      // (same failure as the triage classifier). Fall back to plain text
      // with explicit JSON instructions and parse defensively.
      try {
        const { text } = await generateText({
          model: model as Parameters<typeof generateText>[0]['model'],
          system:
            ACT_SYSTEM +
            '\n\nRespond with ONLY a JSON object, no prose, matching: {"feasible":boolean,"reason"?:string,"steps"?:[{"action":"invoke"|"set_value","role":string,"name":string,"value"?:string}],"prompt"?:string}',
          prompt: actPrompt,
          maxOutputTokens: 300,
        });
        const raw = text
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '');
        const planParsed = actPlanSchema.safeParse(JSON.parse(raw));
        if (planParsed.success) return Response.json({ ok: true, plan: planParsed.data });
      } catch {
        /* fall through */
      }
      return Response.json({
        ok: true,
        plan: { feasible: false, reason: "I couldn't map that to a single safe UI action." },
      });
    }
  }

  const skill = SKILLS[parsed.data.skill]!;

  // ── Workspace knowledge (Jarvis v4.8) ──────────────────────────────
  // Skills used to see ONLY device-local context (timeline/OCR) — the
  // assistant didn't know what the user has in the metu console. Now
  // every skill receives: recent digest, learned preferences, semantic
  // memory recall (screen context as query), and for planning skills
  // the LIVE open tasks + active projects.
  const workspaceContext = await (async () => {
    const db = getDb();
    const wantsTasks = [
      'whats_next',
      'morning_brief',
      'eod_wrap',
      'catch_up',
      'deliberate',
    ].includes(parsed.data.skill);
    const [digestRow, prefRows, taskRows, projectRows, recalled] = await Promise.all([
      db
        .select({ digest: workspaceRecentDigest.digest })
        .from(workspaceRecentDigest)
        .where(eq(workspaceRecentDigest.workspaceId, session.workspaceId))
        .limit(1),
      db
        .select({ content: memoryChunk.content })
        .from(memoryChunk)
        .where(
          and(
            eq(memoryChunk.workspaceId, session.workspaceId),
            eq(memoryChunk.sourceKind, 'manual'),
            like(memoryChunk.content, 'User %'),
            sql`${memoryChunk.metadata} ->> 'origin' = 'companion-learning'`,
          ),
        )
        .orderBy(desc(memoryChunk.createdAt))
        .limit(5),
      wantsTasks
        ? db
            .select({ title: task.title, status: task.status, dueAt: task.dueAt })
            .from(task)
            .where(
              and(
                eq(task.workspaceId, session.workspaceId),
                inArray(task.status, ['next', 'doing', 'blocked']),
              ),
            )
            .orderBy(desc(task.updatedAt))
            .limit(8)
        : Promise.resolve([]),
      wantsTasks
        ? db
            .select({ name: project.name, status: project.status })
            .from(project)
            .where(and(eq(project.workspaceId, session.workspaceId), eq(project.status, 'active')))
            .limit(5)
        : Promise.resolve([]),
      // Semantic recall: current screen/timeline context as the query.
      parsed.data.context
        ? recall({
            workspaceId: session.workspaceId,
            query: parsed.data.context.slice(0, 500),
            limit: 3,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const parts: string[] = [];
    if (digestRow[0]?.digest) parts.push(`[metu workspace digest]\n${digestRow[0].digest}`);
    if (prefRows.length) {
      parts.push(`[User preferences]\n${prefRows.map((p) => `- ${p.content}`).join('\n')}`);
    }
    if (taskRows.length) {
      parts.push(
        `[Open tasks in metu]\n${taskRows
          .map(
            (t) =>
              `- [${t.status}] ${t.title}${t.dueAt ? ` (due ${new Date(t.dueAt).toLocaleDateString()})` : ''}`,
          )
          .join('\n')}`,
      );
    }
    if (projectRows.length) {
      parts.push(`[Active projects]\n${projectRows.map((p) => `- ${p.name}`).join('\n')}`);
    }
    const rows =
      (recalled as { rows?: Array<{ content?: string }> } | null)?.rows ??
      (Array.isArray(recalled) ? (recalled as Array<{ content?: string }>) : []);
    const memories = rows
      .map((r) => r.content)
      .filter((c): c is string => !!c)
      .slice(0, 3);
    if (memories.length) {
      parts.push(`[Relevant memories]\n${memories.map((m) => `- ${m.slice(0, 200)}`).join('\n')}`);
    }
    return parts.join('\n\n');
  })().catch(() => '');

  const langDirective =
    parsed.data.language === 'ro' ? '\n\nIMPORTANT: Reply ONLY in Romanian (limba română).' : '';
  // Dynamic quick-reply chips (Jarvis v3): the model appends ONE trailer
  // line the client strips and renders as tap-chips. Same call — zero
  // extra latency or cost vs a second structured request.
  const chipsDirective = `\n\nAfter your answer, on a NEW final line, output exactly: CHIPS: ["…","…"] — 2 or 3 SHORT follow-up actions (≤ 5 words each) the user would most plausibly tap next, grounded in YOUR answer and their context. Actionable and specific (e.g. "Fix that import error", "Open the PR", "Continue the draft") — never generic filler like "Tell me more".`;
  const blocksDirective = `\n\nRICH BLOCKS: when it improves clarity, embed these fenced blocks in your answer (they render as interactive cards):
\`\`\`metu:status   → lines "ok|warn|error|info <text>" (build/test states)
\`\`\`metu:tasks    → lines "[ ] item" / "[x] item" (checklists w/ counter)
\`\`\`metu:progress → one line "<label> <0..1>" (animated bar)
\`\`\`metu:kv       → lines "Key: Value" (facts/specs)
\`\`\`metu:actions  → lines of tap-to-run actions (each executes like a chip)
Use at most 2 blocks per reply; plain prose is still the default.`;
  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: IDENTITY + skill.system + langDirective + chipsDirective + blocksDirective,
    prompt:
      [parsed.data.context, workspaceContext].filter(Boolean).join('\n\n') ||
      '(no context available)',
    maxOutputTokens: skill.maxOutputTokens + 60,
  });

  return result.toTextStreamResponse();
}
