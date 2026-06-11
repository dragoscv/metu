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
import { generateText, streamText, type ModelMessage } from 'ai';
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

  return `${renderedPersona}

You are running on the FAST LANE of the Companion-Agent. Your job is to:
  - acknowledge and respond in a single short turn (≤ 3 sentences when spoken)
  - call read-only tools when the user is asking what is on screen, what they were working on, or what's in memory
  - NEVER promise to take an action that lives beyond this turn — defer that to your "long memory" and tell the user it'll happen in a moment

If the user asks for anything that requires creating, sending, scheduling,
or contacting an external service, simply acknowledge ("on it — handing
that to the planning side"). The orchestrator will already have escalated
to the Conductor in parallel; your job is just to give them an immediate
voice response.`;
}

function buildLocalContext(input: CompanionTurnInput) {
  const screen = input.screenContext
    ? `\n\n[Live screen context — what the user can currently see]\n${input.screenContext}`
    : '';
  return {
    system: buildSystemPrompt(input) + screen,
    messages: [
      ...input.history.map((m): ModelMessage => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: input.utterance },
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
    maxOutputTokens: 400,
    onStepFinish: (step) => {
      for (const c of step.toolCalls ?? []) {
        if (c.toolName) toolCallNames.push(c.toolName);
      }
    },
  });

  return {
    text: result.text.trim() || 'Mm-hm.',
    toolCallNames,
  };
}

export type LocalStreamEvent =
  | { type: 'delta'; text: string }
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
    maxOutputTokens: 400,
    onStepFinish: (step) => {
      for (const c of step.toolCalls ?? []) {
        if (c.toolName) toolCallNames.push(c.toolName);
      }
    },
  });

  let assembled = '';
  try {
    for await (const delta of result.textStream) {
      assembled += delta;
      yield { type: 'delta', text: delta };
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }
  const text = assembled.trim() || 'Mm-hm.';
  yield { type: 'final', text, toolCallNames };
}
