/**
 * Editor tool family — `editor.*` tools that execute inside the user's
 * editor (today: VS Code; later: JetBrains, Zed). Wired through the same
 * hub `tool.invoke` ↔ `tool.result` round-trip as `device.*`, but targeted
 * at `vscode_ext` connections instead of `companion_desktop`.
 *
 * The flagship V3 tool is `editor.copilot_chat`: the Conductor (or any
 * agent) can ask the user's local Copilot LM for a completion, getting
 * back a string. The extension translates the request into
 * `vscode.lm.selectChatModels({ vendor: 'copilot' })` + `sendRequest()`.
 *
 * Why this matters: every metu user already pays for Copilot. Routing the
 * "agentic" small-model calls (commit messages, code summaries, in-editor
 * Q&A) through the editor avoids a second LLM bill AND lets the agent see
 * the same context window the user already trusts.
 */
import { z } from 'zod';
import {
  getDeviceDispatcher,
  type DeviceDispatcher,
  type DeviceDispatchOpts,
} from './device-tools';
import type { ToolContext, ToolDefinition, ToolKind } from './tools';

const EDITOR_KINDS = ['vscode_ext'] as const;

function editorBridge<TArgs extends z.ZodTypeAny, TResult = unknown>(
  name: string,
  description: string,
  kind: ToolKind,
  args: TArgs,
): ToolDefinition<TArgs, TResult> {
  return {
    name,
    description,
    kind,
    args,
    async execute(parsedArgs, ctx: ToolContext) {
      const dispatcher: DeviceDispatcher | null = getDeviceDispatcher();
      if (!dispatcher) throw new Error('editor_dispatcher_not_registered');
      if (!ctx.toolCallId) throw new Error('editor_tool_requires_tool_call_id');
      const opts: DeviceDispatchOpts = {
        workspaceId: ctx.workspaceId,
        toolCallId: ctx.toolCallId,
        tool: name,
        args: parsedArgs,
        acceptKinds: EDITOR_KINDS,
      };
      const result = (await dispatcher.invoke(opts)) as TResult;
      return { result };
    },
  };
}

// ─── editor.copilot_chat ──────────────────────────────────────────────────

export const editorCopilotChatTool = editorBridge(
  'editor.copilot_chat',
  'Ask the editor’s Copilot language model (or another vendor’s LM exposed via vscode.lm) to complete a single-turn prompt. Returns the assistant’s text response. Requires a connected vscode_ext device.',
  'low_risk',
  z.object({
    prompt: z.string().min(1).max(20_000).describe('User prompt to send.'),
    system: z
      .string()
      .max(4000)
      .optional()
      .describe(
        'Optional system prompt prepended as a User message (vscode.lm has no System role).',
      ),
    family: z
      .string()
      .max(64)
      .optional()
      .describe('Optional model family selector, e.g. "gpt-4o", "claude-sonnet-4".'),
    vendor: z.string().max(64).default('copilot').describe('LM vendor — defaults to "copilot".'),
  }),
);

// ─── editor.show_message ──────────────────────────────────────────────────

export const editorShowMessageTool = editorBridge(
  'editor.show_message',
  'Show a notification banner inside the user’s editor. Useful for hand-offs the user will only see if VS Code is open.',
  'low_risk',
  z.object({
    level: z.enum(['info', 'warning', 'error']).default('info'),
    message: z.string().min(1).max(500),
  }),
);

export const EDITOR_TOOLS = {
  'editor.copilot_chat': editorCopilotChatTool,
  'editor.show_message': editorShowMessageTool,
} as const satisfies Record<string, ToolDefinition<z.ZodTypeAny>>;

export type EditorToolName = keyof typeof EDITOR_TOOLS;
