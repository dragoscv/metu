import { streamText, tool } from 'ai';
import { z } from 'zod';
import { memory, projectIntel } from '@metu/core';
import { getModel } from '@metu/ai';
import { listProjects } from '@metu/db/queries';
import { resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();

  const { messages } = (await req.json()) as { messages: { role: string; content: string }[] };

  const { model } = await getModel({ workspaceId: session.workspaceId, intent: 'agentic' });

  const result = streamText({
    model: model as never,
    messages: messages as never,
    system:
      'You are metu — the user’s second brain. Use the recall tool first if you need context. Be concise. Surface decisions and tradeoffs explicitly.',
    tools: {
      recall: tool({
        description: 'Semantic recall over the workspace memory.',
        inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
        execute: async ({ query, limit }) =>
          memory.recall({ workspaceId: session.workspaceId, query, limit: limit ?? 6 }),
      }),
      listProjects: tool({
        description: 'List projects with momentum.',
        inputSchema: z.object({}),
        execute: async () => listProjects(session.workspaceId),
      }),
      projectPulse: tool({
        description: 'Generate a 3-sentence pulse for a project.',
        inputSchema: z.object({ projectId: z.uuid() }),
        execute: async ({ projectId }) =>
          projectIntel.generateProjectPulse(session.workspaceId, projectId),
      }),
    },
    stopWhen: ({ steps }) => steps.length >= 6,
  });

  return result.toUIMessageStreamResponse();
}
