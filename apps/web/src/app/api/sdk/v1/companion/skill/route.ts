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
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { assertVoiceCap } from '@/lib/voice-billing';

export const runtime = 'nodejs';
export const maxDuration = 30;

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
  const langDirective =
    parsed.data.language === 'ro' ? '\n\nIMPORTANT: Reply ONLY in Romanian (limba română).' : '';
  // Dynamic quick-reply chips (Jarvis v3): the model appends ONE trailer
  // line the client strips and renders as tap-chips. Same call — zero
  // extra latency or cost vs a second structured request.
  const chipsDirective = `\n\nAfter your answer, on a NEW final line, output exactly: CHIPS: ["…","…"] — 2 or 3 SHORT follow-up actions (≤ 5 words each) the user would most plausibly tap next, grounded in YOUR answer and their context. Actionable and specific (e.g. "Fix that import error", "Open the PR", "Continue the draft") — never generic filler like "Tell me more".`;
  const result = streamText({
    model: model as Parameters<typeof streamText>[0]['model'],
    system: skill.system + langDirective + chipsDirective,
    prompt: parsed.data.context || '(no context available)',
    maxOutputTokens: skill.maxOutputTokens + 60,
  });

  return result.toTextStreamResponse();
}
