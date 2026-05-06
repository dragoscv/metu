/**
 * Bridge: adapt our tool registry to the Vercel AI SDK `tool()` shape so the
 * model can call them through `streamText` / `generateText`.
 *
 * Read-only tools (kind='read') are exposed as-is — the model can call them
 * freely. Mutating tools are exposed but every invocation is funneled through
 * `runTool()` so the per-workspace ACL kicks in (ask/auto/autopilot/observe).
 */
import { tool, type Tool } from 'ai';
import { TOOLS, type ToolName } from './tools';
import { runTool } from './policy';

export interface BuildToolsInput {
  workspaceId: string;
  userId: string;
  conversationId?: string | null;
  messageId?: string | null;
  agentRunId?: string | null;
}

export function buildAiTools(ctx: BuildToolsInput): Record<string, Tool> {
  const out: Record<string, Tool> = {};
  for (const [name, def] of Object.entries(TOOLS)) {
    out[name] = tool({
      description: def.description,
      inputSchema: def.args,
      execute: async (args: unknown) => {
        const r = await runTool({
          ...ctx,
          tool: name as ToolName,
          args,
        });
        if (r.status === 'success') return r.result;
        if (r.status === 'awaiting_approval') {
          return {
            __awaiting_approval: true,
            toolCallId: r.toolCallId,
            note: 'User approval required before this action runs.',
          };
        }
        return {
          __error: true,
          status: r.status,
          error: r.error ?? 'failed',
        };
      },
    });
  }
  return out;
}
