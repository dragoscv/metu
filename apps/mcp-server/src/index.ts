/**
 * metu MCP server.
 *
 * Exposes the FULL Conductor tool registry as MCP tools so any MCP client
 * (Claude Desktop, Cursor, VS Code Copilot via mcp.json) can drive the
 * second brain end-to-end. Every call goes through `runTool()` so
 * workspace ACL, audit (`tool_call`), cost meters, and recursion limits
 * apply identically to in-app agent runs.
 *
 * Auth: bearer-token only (`metu_at_*`). Tokens are minted in the web
 * app's `/apps` UI ("Mint token" on any registered oauthClient). The
 * token's row determines:
 *   - `workspaceId` and `userId` for `runTool`
 *   - `scopes` — calls to tools require `tools:invoke` scope
 *
 * Stdio mode (default): reads `METU_API_TOKEN` once at boot, resolves
 * the workspace+user, and serves a single tenant.
 *
 * HTTP mode (`METU_MCP_HTTP_PORT`): per-request `Authorization: Bearer
 * metu_at_*` header. Each SSE session resolves its own token, so a
 * single hosted MCP server can serve many tenants.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { initNodeSentry } from '@metu/logger';
import { runTool, TOOLS, type ToolName } from '@metu/core/agent';
import { runCompanionTurn } from '@metu/core/companion-agent';
import { hashToken, parseScopes } from '@metu/auth/oauth';
import { getDb } from '@metu/db';
import { listProjects, listTimelineFiltered } from '@metu/db/queries';
import { oauthToken } from '@metu/db/schema';

await initNodeSentry({ service: 'mcp-server' });

// ─── Token resolution ──────────────────────────────────────────────────────

interface ResolvedAuth {
  workspaceId: string;
  userId: string;
  scopes: string[];
}

async function resolveToken(token: string): Promise<ResolvedAuth | null> {
  if (!token.startsWith('metu_at_')) return null;
  const db = getDb();
  const [row] = await db
    .select()
    .from(oauthToken)
    .where(
      and(
        eq(oauthToken.tokenHash, hashToken(token)),
        eq(oauthToken.kind, 'access_token'),
        isNull(oauthToken.consumedAt),
        isNull(oauthToken.revokedAt),
        gt(oauthToken.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row || !row.userId) return null;
  // Throttled liveness ping (max once / 60s) — same pattern as
  // apps/web's findActiveTokenByHash. Surfaces "mcp last seen" on /apps.
  const sixtySecondsAgo = new Date(Date.now() - 60_000);
  void db
    .update(oauthToken)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(oauthToken.id, row.id),
        or(isNull(oauthToken.lastUsedAt), lt(oauthToken.lastUsedAt, sixtySecondsAgo)),
      ),
    )
    .catch(() => {});
  return {
    workspaceId: row.workspaceId,
    userId: row.userId,
    scopes: parseScopes(row.scopes),
  };
}

function hasScope(auth: ResolvedAuth, ...required: string[]): boolean {
  if (auth.scopes.includes('*')) return true;
  return required.some((s) => auth.scopes.includes(s));
}

// Resolved once at boot. Used to render fully-qualified `/audit/<id>` URLs
// in awaiting_approval messages so MCP clients (which display plain text)
// produce a clickable link instead of a bare path. Falls back to a token
// users can paste; never throws.
const WEB_URL = (process.env.METU_WEB_URL ?? 'https://metu.ro').replace(/\/+$/, '');

function auditUrl(toolCallId: string): string {
  return `${WEB_URL}/audit/${toolCallId}`;
}

// ─── MCP tool surface (shared) ─────────────────────────────────────────────

const COMPANION_TOOL_NAME = 'metu.companion_turn';
const COMPANION_CHAIN_TOOL_NAME = 'metu.companion_chain';
const companionTurnArgs = z.object({
  personaSlug: z
    .string()
    .min(1)
    .max(80)
    .describe('Built-in persona slug, e.g. "metu", "fox", "owl".'),
  utterance: z.string().min(1).max(4000).describe('What the user said. Plain text.'),
  eagerness: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('0–100. Higher → more likely to escalate to the conductor.'),
});

const companionChainArgs = companionTurnArgs.extend({
  followUp: z
    .string()
    .min(1)
    .max(4000)
    .optional()
    .describe(
      'Optional second utterance run *only* if the first turn stayed local. Useful for "try local, then ask deeper".',
    ),
});

const COMPANION_MCP_TOOL = {
  name: COMPANION_TOOL_NAME,
  description:
    '[companion-agent] Run one companion-agent turn for a built-in persona. Returns either a local reply or an escalation ack.',
  inputSchema: z.toJSONSchema(companionTurnArgs) as Record<string, unknown>,
};

const COMPANION_CHAIN_MCP_TOOL = {
  name: COMPANION_CHAIN_TOOL_NAME,
  description:
    '[companion-agent] Run a companion turn, then either (a) escalate hint if the first turn already escalated, or (b) optionally run a follow-up utterance to deepen the local response. Returns the full chain.',
  inputSchema: z.toJSONSchema(companionChainArgs) as Record<string, unknown>,
};

const MCP_TOOLS = [
  COMPANION_MCP_TOOL,
  COMPANION_CHAIN_MCP_TOOL,
  ...Object.values(TOOLS).map((t) => ({
    name: t.name,
    description: `[${t.kind}] ${t.description}`,
    inputSchema: z.toJSONSchema(t.args) as Record<string, unknown>,
  })),
];

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function dispatchCompanionTurn(
  auth: ResolvedAuth,
  args: Record<string, unknown>,
): Promise<{
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}> {
  if (!hasScope(auth, 'tools:invoke')) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'token missing required scope: tools:invoke' }],
    };
  }
  const parsed = companionTurnArgs.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: parsed.error.issues[0]?.message ?? 'invalid args' }],
    };
  }
  try {
    const result = await runCompanionTurn({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      personaSlug: parsed.data.personaSlug,
      utterance: parsed.data.utterance,
      history: [],
      eagerness: parsed.data.eagerness ?? 50,
      surface: 'mcp',
    });
    if (result.kind === 'local') {
      return {
        content: [{ type: 'text', text: result.text }],
        structuredContent: { lane: 'local', triage: result.triage },
      };
    }
    return {
      content: [
        { type: 'text', text: result.ack },
        { type: 'text', text: '(escalated to conductor — check the timeline for the full reply)' },
      ],
      structuredContent: { lane: 'escalate', triage: result.triage, eventId: result.eventId },
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `companion turn failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

async function dispatchCompanionChain(
  auth: ResolvedAuth,
  args: Record<string, unknown>,
): Promise<{
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
}> {
  if (!hasScope(auth, 'tools:invoke')) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'token missing required scope: tools:invoke' }],
    };
  }
  const parsed = companionChainArgs.safeParse(args);
  if (!parsed.success) {
    return {
      isError: true,
      content: [{ type: 'text', text: parsed.error.issues[0]?.message ?? 'invalid args' }],
    };
  }
  try {
    const first = await runCompanionTurn({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      personaSlug: parsed.data.personaSlug,
      utterance: parsed.data.utterance,
      history: [],
      eagerness: parsed.data.eagerness ?? 50,
      surface: 'mcp',
    });
    if (first.kind === 'escalated') {
      return {
        content: [
          { type: 'text', text: first.ack },
          {
            type: 'text',
            text: '(first turn escalated — open metu and watch the timeline for the full reply; no follow-up was sent)',
          },
        ],
        structuredContent: {
          step1: { lane: 'escalate', triage: first.triage, eventId: first.eventId },
        },
      };
    }
    if (!parsed.data.followUp) {
      return {
        content: [{ type: 'text', text: first.text }],
        structuredContent: { step1: { lane: 'local', triage: first.triage } },
      };
    }
    const second = await runCompanionTurn({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      personaSlug: parsed.data.personaSlug,
      utterance: parsed.data.followUp,
      history: [
        { role: 'user', content: parsed.data.utterance },
        { role: 'assistant', content: first.text },
      ],
      eagerness: parsed.data.eagerness ?? 50,
      surface: 'mcp',
    });
    if (second.kind === 'escalated') {
      return {
        content: [
          { type: 'text', text: first.text },
          { type: 'text', text: '---' },
          { type: 'text', text: second.ack },
          { type: 'text', text: '(follow-up escalated — check the timeline for the full reply)' },
        ],
        structuredContent: {
          step1: { lane: 'local', triage: first.triage },
          step2: { lane: 'escalate', triage: second.triage, eventId: second.eventId },
        },
      };
    }
    return {
      content: [
        { type: 'text', text: first.text },
        { type: 'text', text: '---' },
        { type: 'text', text: second.text },
      ],
      structuredContent: {
        step1: { lane: 'local', triage: first.triage },
        step2: { lane: 'local', triage: second.triage },
      },
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `companion chain failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

// Progress notifications: heartbeat while a tool is in flight.
//
// MCP clients (Claude Desktop, Cursor) display a spinner that goes stale if
// they get no signal for ~30s. Many of our tools — `editor.copilot_chat`,
// `device.*` round-trips, future planner runs — easily take longer than
// that. Until we plumb real partial output through `runTool` → device
// dispatcher → hub → vscode_ext (a much bigger change), a periodic
// heartbeat keeps the UI alive and tells the user *something* is happening.
const PROGRESS_HEARTBEAT_MS = 1500;

type ProgressToken = string | number;
type SendProgress = (params: {
  progressToken: ProgressToken;
  progress: number;
  total?: number;
  message?: string;
}) => Promise<void>;

async function dispatchToolCall(
  auth: ResolvedAuth,
  name: string,
  args: Record<string, unknown>,
  progressToken: ProgressToken | undefined,
  sendProgress: SendProgress,
) {
  if (name === COMPANION_TOOL_NAME) {
    return dispatchCompanionTurn(auth, args);
  }
  if (name === COMPANION_CHAIN_TOOL_NAME) {
    return dispatchCompanionChain(auth, args);
  }
  if (!Object.prototype.hasOwnProperty.call(TOOLS, name)) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: `unknown tool: ${name}` }],
    };
  }
  if (!hasScope(auth, 'tools:invoke')) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: 'token missing required scope: tools:invoke' }],
    };
  }

  // Heartbeat — only when the client opted in by sending a progressToken.
  let tick = 0;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  if (progressToken !== undefined) {
    // Fire one immediate ping so the client sees "started" before the first interval.
    await sendProgress({
      progressToken,
      progress: 0,
      message: `running ${name}…`,
    }).catch(() => {});
    heartbeat = setInterval(() => {
      tick += 1;
      // `progress` must monotonically increase per spec. Use elapsed seconds.
      void sendProgress({
        progressToken,
        progress: tick * (PROGRESS_HEARTBEAT_MS / 1000),
        message: `still running ${name}…`,
      }).catch(() => {});
    }, PROGRESS_HEARTBEAT_MS);
  }

  try {
    const result = await runTool({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      tool: name as ToolName,
      args,
    });
    if (result.status === 'success') {
      return {
        content: [{ type: 'text' as const, text: stringify(result.result ?? { ok: true }) }],
        structuredContent: { toolCallId: result.toolCallId, status: result.status },
      };
    }
    const detail =
      result.status === 'awaiting_approval'
        ? `Awaiting approval. Open ${auditUrl(result.toolCallId)} to approve or reject.`
        : (result.error ?? `tool ${result.status}`);
    return {
      isError: true,
      content: [
        { type: 'text' as const, text: `[${result.status}] ${detail}` },
        { type: 'text' as const, text: `tool_call_id: ${result.toolCallId}` },
      ],
    };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

// ─── MCP prompts (workflow recipes) ────────────────────────────────────────
// Most MCP clients (Claude Desktop, VS Code, Cursor) now surface prompts as
// slash-commands. These encode metu's highest-value workflows so users don't
// have to remember which tools to chain.

const MCP_PROMPTS = [
  {
    name: 'resume-work',
    description:
      'Where did I leave off? Recalls recent context and proposes the next minimum-viable step.',
    arguments: [
      {
        name: 'project',
        description: 'Optional project name to focus on',
        required: false,
      },
    ],
  },
  {
    name: 'capture-thought',
    description: 'Capture a thought/note/idea into metu memory with proper tagging.',
    arguments: [{ name: 'text', description: 'The thought to capture', required: true }],
  },
  {
    name: 'daily-review',
    description: 'Summarize today: timeline events, decisions, open approvals, and goal progress.',
    arguments: [],
  },
] as const;

function promptMessages(
  name: string,
  args: Record<string, string>,
): Array<{
  role: 'user';
  content: { type: 'text'; text: string };
}> {
  switch (name) {
    case 'resume-work':
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use the metu recall and resume tools to figure out where I left off${
              args.project ? ` on the project "${args.project}"` : ''
            }. Then give me: (1) a 3-line summary of the last working state, (2) why I stopped if known, (3) the next minimum-viable step. Be concrete.`,
          },
        },
      ];
    case 'capture-thought':
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Capture the following into metu using the capture tool, choosing a sensible kind and tags:\n\n${args.text ?? ''}`,
          },
        },
      ];
    case 'daily-review':
      return [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Use metu timeline, audit, and goals tools to produce a daily review: what happened today, decisions made, tool calls awaiting approval, and goal drift. End with the single most important thing to do next.',
          },
        },
      ];
    default:
      return [{ role: 'user', content: { type: 'text', text: `Unknown prompt: ${name}` } }];
  }
}

// ─── MCP resources (read-only context) ─────────────────────────────────────
// Resources let MCP clients attach workspace context to a conversation
// without invoking a tool (no ACL run needed — these are read-only views,
// still scope-gated on `recall:read`).

const MCP_RESOURCES = [
  {
    uri: 'metu://projects',
    name: 'Projects',
    description: 'Active projects in the workspace with status and momentum.',
    mimeType: 'application/json',
  },
  {
    uri: 'metu://timeline/today',
    name: "Today's timeline",
    description: 'Timeline events from the last 24 hours (most recent first, max 50).',
    mimeType: 'application/json',
  },
] as const;

async function readResource(auth: ResolvedAuth, uri: string): Promise<string> {
  if (!hasScope(auth, 'recall:read', 'recall')) {
    throw new Error('token missing required scope: recall:read');
  }
  switch (uri) {
    case 'metu://projects': {
      const rows = await listProjects(auth.workspaceId);
      return stringify(rows);
    }
    case 'metu://timeline/today': {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const { items } = await listTimelineFiltered({
        workspaceId: auth.workspaceId,
        since,
        cursor: null,
        limit: 50,
      });
      return stringify(
        items.map((e) => ({
          kind: e.kind,
          title: e.title,
          body: e.body,
          occurredAt: e.occurredAt,
          projectId: e.projectId,
        })),
      );
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

const SERVER_CAPABILITIES = { capabilities: { tools: {}, prompts: {}, resources: {} } };

function bindHandlers(s: Server, authProvider: () => ResolvedAuth | null): void {
  s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }));
  s.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [...MCP_RESOURCES],
  }));
  s.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const auth = authProvider();
    if (!auth) throw new Error('unauthorized');
    const text = await readResource(auth, req.params.uri);
    return {
      contents: [{ uri: req.params.uri, mimeType: 'application/json', text }],
    };
  });
  s.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: MCP_PROMPTS.map((p) => ({ ...p, arguments: [...p.arguments] })),
  }));
  s.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const known = MCP_PROMPTS.find((p) => p.name === name);
    if (!known) throw new Error(`Unknown prompt: ${name}`);
    return {
      description: known.description,
      messages: promptMessages(name, args as Record<string, string>),
    };
  });
  s.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const auth = authProvider();
    if (!auth) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'unauthorized' }],
      };
    }
    const { name, arguments: args = {} } = req.params;
    const progressToken = req.params._meta?.progressToken as ProgressToken | undefined;
    const sendProgress: SendProgress = async (params) => {
      await extra.sendNotification({
        method: 'notifications/progress',
        params,
      });
    };
    return dispatchToolCall(auth, name, args, progressToken, sendProgress);
  });
}

// ─── Stdio transport ───────────────────────────────────────────────────────

const stdioToken = process.env.METU_API_TOKEN;
if (stdioToken) {
  const auth = await resolveToken(stdioToken);
  if (!auth) {
    throw new Error('METU_API_TOKEN is invalid, expired, or revoked. Mint a new one in /apps.');
  }
  const stdio = new StdioServerTransport();
  const server = new Server({ name: 'metu', version: '0.5.0' }, SERVER_CAPABILITIES);
  bindHandlers(server, () => auth);
  await server.connect(stdio);
  console.error(
    `[metu-mcp] stdio connected · workspace=${auth.workspaceId.slice(0, 8)} · ${MCP_TOOLS.length} tools`,
  );
} else {
  console.error('[metu-mcp] METU_API_TOKEN not set — stdio transport disabled');
}

// ─── HTTP transport (optional) ─────────────────────────────────────────────

// Cloud Run injects `PORT` (default 8080); local dev uses METU_MCP_HTTP_PORT.
// Either turns on the Streamable HTTP transport.
const HTTP_PORT_RAW = process.env.PORT ?? process.env.METU_MCP_HTTP_PORT;
const HTTP_PORT = HTTP_PORT_RAW ? Number.parseInt(HTTP_PORT_RAW, 10) : null;

if (HTTP_PORT !== null && Number.isFinite(HTTP_PORT)) {
  startHttpTransport(HTTP_PORT);
}

if (!stdioToken && (HTTP_PORT === null || !Number.isFinite(HTTP_PORT))) {
  throw new Error(
    'No transport configured. Set METU_API_TOKEN (stdio) and/or PORT / METU_MCP_HTTP_PORT (http).',
  );
}

function startHttpTransport(port: number): void {
  // Streamable HTTP (MCP 2025-03-26 spec). Single `/mcp` endpoint:
  //   - POST without `mcp-session-id` → initialize: spawns a new transport
  //     + Server, captures auth in closure, registers session.
  //   - POST/GET with `mcp-session-id` → routed to existing transport.
  //   - DELETE with `mcp-session-id` → terminates the session.
  // Each session pins to the auth that opened it; subsequent requests are
  // re-authorized and rejected if the token now resolves to a different
  // user/workspace (revocation + hijack protection).
  interface SessionEntry {
    transport: StreamableHTTPServerTransport;
    server: Server;
    auth: ResolvedAuth;
  }
  const sessions = new Map<string, SessionEntry>();

  const httpServer = createServer(async (req, res) => {
    // Cloud Run startup + liveness probes hit `/health`. Keep it cheap:
    // no DB call, no auth — just confirm the process is up.
    if (req.url === '/health' || req.url === '/healthz') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ ok: true, tools: MCP_TOOLS.length, version: '0.4.0' }));
      return;
    }
    // RFC 9728 protected-resource metadata. MCP clients use this to
    // discover the authorization server and run OAuth 2.1 + PKCE against
    // the web app's existing provider, instead of requiring a manually
    // minted metu_at_* token. Tokens issued by /api/oauth/token are the
    // same metu_at_* format `resolveToken()` already accepts.
    if (req.url === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          resource: process.env.METU_MCP_PUBLIC_URL ?? `${WEB_URL}/mcp`,
          authorization_servers: [WEB_URL],
          bearer_methods_supported: ['header'],
          scopes_supported: ['tools:invoke', 'recall:read', 'capture', 'notify'],
          resource_documentation: `${WEB_URL}/docs/mcp`,
        }),
      );
      return;
    }
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end('not found');
      return;
    }

    const sessionId = headerValue(req, 'mcp-session-id');

    // Re-authorize on every request so revocation takes effect immediately.
    const auth = await authorize(req, res);
    if (!auth) return;

    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) {
        res.writeHead(404).end('unknown session');
        return;
      }
      if (auth.userId !== entry.auth.userId || auth.workspaceId !== entry.auth.workspaceId) {
        res.writeHead(403).end('token mismatch for session');
        return;
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    // No session header → must be an initialize POST. Spin up a new
    // transport and server.
    if (req.method !== 'POST') {
      res.writeHead(400).end('missing mcp-session-id');
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server, auth });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });
    const server = new Server({ name: 'metu', version: '0.5.0' }, SERVER_CAPABILITIES);
    bindHandlers(server, () => auth);
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  httpServer.listen(port, () => {
    console.error(`[metu-mcp] Streamable HTTP listening on :${port}/mcp`);
  });
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

async function authorize(req: IncomingMessage, res: ServerResponse): Promise<ResolvedAuth | null> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const resourceMetadata = `${
    process.env.METU_MCP_PUBLIC_URL?.replace(/\/mcp$/, '') ?? WEB_URL
  }/.well-known/oauth-protected-resource`;
  const challenge = `Bearer realm="metu", resource_metadata="${resourceMetadata}"`;
  if (!token) {
    res.writeHead(401, { 'www-authenticate': challenge }).end('unauthorized');
    return null;
  }
  const auth = await resolveToken(token);
  if (!auth) {
    res.writeHead(401, { 'www-authenticate': challenge }).end('invalid token');
    return null;
  }
  return auth;
}
