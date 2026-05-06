/**
 * metu MCP server.
 *
 * Exposes second-brain primitives as MCP tools so any MCP client (Claude
 * Desktop, Cursor, VS Code Copilot via mcp.json) can read and write metu
 * memory.
 *
 * Tools:
 *   metu.recall            — semantic recall over memory
 *   metu.list_projects     — projects with momentum
 *   metu.project_pulse     — pulse for a project
 *   metu.restore_context   — "where was I" briefing
 *   metu.create_capture    — push a capture into the inbox
 *   metu.log_decision      — log an architectural decision
 *
 * Auth: WORKSPACE_ID + METU_API_TOKEN env (token is a user PAT minted in /settings).
 *
 * Transports: stdio (local clients) + streamable HTTP (Cloud Run). Default stdio.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { memory, continuity, projectIntel } from '@metu/core';
import { listProjects } from '@metu/db/queries';
import { getDb } from '@metu/db';
import { capture, decision, timelineEvent } from '@metu/db/schema';

const WORKSPACE_ID = process.env.METU_WORKSPACE_ID;
if (!WORKSPACE_ID) throw new Error('METU_WORKSPACE_ID required');

const server = new Server({ name: 'metu', version: '0.1.0' }, { capabilities: { tools: {} } });

const TOOLS = [
  {
    name: 'metu.recall',
    description: 'Semantic recall over the workspace memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        projectId: { type: 'string' },
        limit: { type: 'number', default: 8 },
      },
      required: ['query'],
    },
  },
  {
    name: 'metu.list_projects',
    description: 'List active projects with momentum scores',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'metu.project_pulse',
    description: 'Generate a 3-sentence pulse for a project',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'metu.restore_context',
    description: '"Where was I" 4-paragraph briefing for a project',
    inputSchema: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
    },
  },
  {
    name: 'metu.create_capture',
    description: 'Capture a thought, decision, or note into the inbox',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        projectId: { type: 'string' },
        kind: { type: 'string', default: 'text' },
      },
      required: ['content'],
    },
  },
  {
    name: 'metu.log_decision',
    description: 'Log an architectural or product decision with rationale',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        rationale: { type: 'string' },
        projectId: { type: 'string' },
      },
      required: ['title', 'rationale'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const ws = WORKSPACE_ID!;
  const db = getDb();

  switch (name) {
    case 'metu.recall': {
      const a = z
        .object({
          query: z.string(),
          projectId: z.string().optional(),
          limit: z.number().optional(),
        })
        .parse(args);
      const rows = await memory.recall({
        workspaceId: ws,
        query: a.query,
        projectId: a.projectId,
        limit: a.limit ?? 8,
      });
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
    case 'metu.list_projects': {
      const rows = await listProjects(ws);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    }
    case 'metu.project_pulse': {
      const a = z.object({ projectId: z.string() }).parse(args);
      const r = await projectIntel.generateProjectPulse(ws, a.projectId);
      return { content: [{ type: 'text', text: r.pulse }] };
    }
    case 'metu.restore_context': {
      const a = z.object({ projectId: z.string() }).parse(args);
      const r = await continuity.restoreProjectContext(ws, a.projectId);
      return { content: [{ type: 'text', text: r.briefing }] };
    }
    case 'metu.create_capture': {
      const a = z
        .object({
          content: z.string(),
          projectId: z.string().optional(),
          kind: z.string().default('text'),
        })
        .parse(args);
      const [row] = await db
        .insert(capture)
        .values({
          workspaceId: ws,
          userId: process.env.METU_USER_ID!, // PAT issuer
          projectId: a.projectId ?? null,
          kind: a.kind as 'text',
          status: 'ready',
          content: a.content,
          source: 'mcp',
        })
        .returning();
      return { content: [{ type: 'text', text: `captured ${row?.id}` }] };
    }
    case 'metu.log_decision': {
      const a = z
        .object({
          title: z.string(),
          rationale: z.string(),
          projectId: z.string().optional(),
        })
        .parse(args);
      const [row] = await db
        .insert(decision)
        .values({
          workspaceId: ws,
          projectId: a.projectId ?? null,
          title: a.title,
          rationale: a.rationale,
        })
        .returning();
      await db.insert(timelineEvent).values({
        workspaceId: ws,
        projectId: a.projectId ?? null,
        kind: 'decision.logged',
        title: a.title,
        importance: 0.8,
      });
      return { content: [{ type: 'text', text: `logged ${row?.id}` }] };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[metu-mcp] connected via stdio');
