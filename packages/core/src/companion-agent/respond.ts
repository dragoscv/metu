/**
 * Local lane — fast on-device-style response.
 *
 * Uses `intent: 'fast'` (Claude Haiku 4 / GPT-4o-mini / Gemini Flash by
 * default) plus a strict allowlist of read-only tools. We do NOT expose
 * mutating tools here; the planner+ACL on the heavy Conductor is the
 * place for those. Read tools still funnel through `runTool()` so any
 * per-workspace ACL override (e.g. `device.screenshot` set to "ask")
 * is honoured even on the fast lane.
 *
 * Returns the full text + the tool names that were called. Streaming is
 * handled at the SDK route layer; keeping this synchronous makes it
 * trivially testable.
 */
import { generateText, streamText, stepCountIs, type ModelMessage } from 'ai';
import { getModel } from '@metu/ai';
import { TOOLS, type ToolName } from '../agent/tools';
import { buildAiTools } from '../agent/ai-tools';
import { getBuiltInPersona } from '@metu/presence';
import { renderPersonaPrompt } from './prompt-template';
import type { CompanionTurnInput } from './types';

/**
 * Tools the local lane is allowed to call. Everything here must be either
 * read-only (`kind: 'read'`) or guaranteed-side-effect-free.
 *
 * Mutating tools (create_task, notify_user, GitHub etc.) intentionally
 * absent — those belong to Conductor escalation.
 */
const LOCAL_TOOL_ALLOWLIST: readonly ToolName[] = [
  'recall',
  'list_projects',
  'list_tasks',
  'restore_continuity',
  // Intelligence pass (Jarvis v5.1): full read access to the console —
  // workspace-wide briefings and day summaries are read-only generators.
  'briefing_generate',
  'summarize_day',
  'device.screenshot',
  'device.list_windows',
  'device.a11y_tree',
  'device.a11y_find',
  'device.observe_window',
  'device.see',
] as const;

function buildSystemPrompt(input: CompanionTurnInput): string {
  const persona = getBuiltInPersona(input.personaSlug);
  const personaPrompt =
    persona?.systemPrompt ??
    'You are a helpful, fast assistant inside a personal AI operating system.';

  const renderedPersona = renderPersonaPrompt(personaPrompt, {
    personaName: persona?.name,
    userName: input.promptContext?.userName,
    language: input.promptContext?.language,
    recentDigest: input.promptContext?.recentDigest,
  });

  // Explicit response-language directive: persona templates may or may not
  // reference {{language}}, so enforce it directly when the user picked one.
  const lang = input.promptContext?.language;
  const langDirective = lang
    ? `\n\nIMPORTANT: Reply ONLY in ${lang === 'ro' ? 'Romanian (limba română)' : lang === 'en' ? 'English' : lang}, regardless of the language the user writes in.`
    : '';

  // Learned preferences (Jarvis v3.2): what the user has told us to
  // remember — always honored, no recall round-trip needed.
  const prefs = input.promptContext?.preferences
    ? `\n\nThings this user has told you to remember (honor them):\n${input.promptContext.preferences}`
    : '';

  return `${renderedPersona}${langDirective}${prefs}

You ARE metu — the user's personal AI operating system. The desktop avatar (the small robot), this chat, the memory, and the metu console (projects/tasks/goals/timeline) are all YOU — one continuous being across surfaces. The user is an AI-agent ORCHESTRATOR: they direct AI coding agents (VS Code Copilot, Codai — the same gateway YOUR thinking runs on) that write the code; never assume they hand-typed what's on screen ("your agent shipped X", not "you wrote X"). When their screen shows metu source or commits about "companion"/"avatar"/"conductor", their agents are improving YOU — first person always ("my chat panel", "my dodge fix"), never "the metu assistant" in third person.

Your tools reach the WHOLE console: recall (semantic memory), list_projects/list_tasks (live data), restore_continuity + briefing_generate (where-was-I narratives), summarize_day (journal), and device.* (screen). USE them — answer from real data, never guess about the user's workspace.

You are running on the FAST LANE of the Companion-Agent. Your job is to:
  - acknowledge and respond in a single short turn (≤ 3 sentences when spoken)
  - EXCEPTION — brainstorming/ideation ("I want to build…", "how should I…"): engage substantively — give a concrete take, 2-3 sharp options with trade-offs, and ONE next step; up to ~8 sentences
  - call read-only tools when the user is asking what is on screen, what they were working on, or what's in memory
  - after calling tools you MUST answer using their results — never end the turn on a bare tool call
  - NEVER promise to take an action that lives beyond this turn — defer that to your "long memory" and tell the user it'll happen in a moment

If the user asks for anything that requires creating, sending, scheduling,
or contacting an external service, simply acknowledge ("on it — handing
that to the planning side"). The orchestrator will already have escalated
to the Conductor in parallel; your job is just to give them an immediate
voice response.

After your answer, on a NEW final line, output exactly: CHIPS: ["…","…"] — 2 or 3 SHORT follow-up actions (≤ 5 words each) the user would plausibly tap next, grounded in YOUR answer. Specific, never generic filler.`;
}

function buildLocalContext(input: CompanionTurnInput) {
  const screen = input.screenContext
    ? `\n\n[Live screen context — what the user can currently see]\n${input.screenContext}`
    : '';
  // Attached files ride on the user message itself (not the system
  // prompt) so history replay keeps the pairing between question and
  // documents.
  const files = input.attachments?.length
    ? '\n\n' +
      input.attachments
        .map((f) => `[Attached file: ${f.name}${f.truncated ? ' (truncated)' : ''}]\n${f.content}`)
        .join('\n\n')
    : '';
  return {
    system: buildSystemPrompt(input) + screen,
    messages: [
      ...input.history.map((m): ModelMessage => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: input.utterance + files },
    ],
  };
}

function buildLocalTools(input: CompanionTurnInput) {
  const allTools = buildAiTools({
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  const tools: typeof allTools = {};
  for (const name of LOCAL_TOOL_ALLOWLIST) {
    if (Object.prototype.hasOwnProperty.call(TOOLS, name) && allTools[name]) {
      tools[name] = allTools[name];
    }
  }
  return tools;
}

export interface RespondLocalResult {
  text: string;
  toolCallNames: string[];
}

/** Strip the CHIPS trailer for consumers that don't render chips. */
function stripChipsTrailer(text: string): string {
  return text.replace(/\n?CHIPS:\s*\[[\s\S]*?\]\s*$/, '').trimEnd();
}

export async function respondLocal(input: CompanionTurnInput): Promise<RespondLocalResult> {
  const { model } = await getModel({
    workspaceId: input.workspaceId,
    intent: 'fast',
  });
  const { system, messages } = buildLocalContext(input);
  const tools = buildLocalTools(input);

  const toolCallNames: string[] = [];
  const result = await generateText({
    model: model as Parameters<typeof generateText>[0]['model'],
    system,
    messages,
    tools,
    maxOutputTokens: 700,
    // CRITICAL: AI SDK v5 defaults to ONE step — the model calls a tool
    // and generation ENDS with empty text (the user sees tool badges and
    // silence). Allow tool → result → answer loops up to 4 steps.
    stopWhen: stepCountIs(5),
    onStepFinish: (step) => {
      for (const c of step.toolCalls ?? []) {
        if (c.toolName) toolCallNames.push(c.toolName);
      }
    },
  });

  return {
    text: stripChipsTrailer(result.text.trim()) || 'Mm-hm.',
    toolCallNames,
  };
}

export type LocalStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; status: 'start' | 'done' }
  | { type: 'final'; text: string; toolCallNames: string[] }
  | { type: 'error'; message: string };

/**
 * Streaming local lane. Yields delta chunks as the model produces them,
 * then a single `final` event with the assembled text + any tools that
 * were called. The route layer wraps this as NDJSON for transport.
 */
export async function* streamLocal(input: CompanionTurnInput): AsyncGenerator<LocalStreamEvent> {
  let modelInfo;
  try {
    modelInfo = await getModel({ workspaceId: input.workspaceId, intent: 'fast' });
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }
  const { system, messages } = buildLocalContext(input);
  const tools = buildLocalTools(input);

  const toolCallNames: string[] = [];
  const result = streamText({
    model: modelInfo.model as Parameters<typeof streamText>[0]['model'],
    system,
    messages,
    tools,
    maxOutputTokens: 700,
    // Same multi-step fix as respondLocal: without stopWhen the stream
    // ends right after the first tool call — "list_projects, list_tasks"
    // badges and then SILENCE was exactly this.
    stopWhen: stepCountIs(5),
    onStepFinish: (step) => {
      for (const c of step.toolCalls ?? []) {
        if (c.toolName) toolCallNames.push(c.toolName);
      }
    },
  });

  let assembled = '';
  try {
    // fullStream (not textStream): we want TOOL lifecycle parts too, so
    // the client can render live "⚒ recall…" activity like an IDE agent
    // instead of dead air while tools run.
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        assembled += part.text;
        yield { type: 'delta', text: part.text };
      } else if (part.type === 'tool-call') {
        yield { type: 'tool', name: part.toolName, status: 'start' };
      } else if (part.type === 'tool-result') {
        yield { type: 'tool', name: part.toolName, status: 'done' };
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }
  let text = assembled.trim();
  if (!text && toolCallNames.length === 0) {
    // Some gateway models (codai auto-router) return empty text when the
    // request carries tool definitions they can't handle. Retry once
    // without tools — a plain answer beats a grunt.
    try {
      const retry = await generateText({
        model: modelInfo.model as Parameters<typeof generateText>[0]['model'],
        system,
        messages,
        maxOutputTokens: 700,
      });
      text = retry.text.trim();
      if (text) yield { type: 'delta', text };
    } catch {
      /* fall through to the grunt */
    }
  }
  yield { type: 'final', text: text || 'Mm-hm.', toolCallNames };
}
