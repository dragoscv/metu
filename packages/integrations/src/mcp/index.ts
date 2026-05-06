/**
 * External MCP integration — METU as an MCP **client** of other servers.
 *
 * Each registered `external_mcp` integration row stores:
 *   - `config.url`            — base URL of the remote MCP server
 *                                (e.g. `https://notai.app/mcp`)
 *   - `config.tokenSealed`    — `Sealed` envelope of the bearer token
 *   - `config.toolPrefix`     — namespace prefix added to tool names so
 *                                multiple servers can coexist (e.g. "notai")
 *   - `config.toolAllowlist`  — optional array of tool names to expose;
 *                                empty = all
 *   - `config.lastTools`      — cached list of tools (name+description)
 *
 * The token is sealed with `@metu/ai` envelope encryption — same key as BYOK.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { open as openSealed, seal, type Sealed } from '@metu/ai';

export interface ExternalMcpConfig {
  url: string;
  tokenSealed: Sealed | null;
  toolPrefix: string;
  toolAllowlist?: string[];
  lastTools?: Array<{ name: string; description?: string }>;
}

export interface RemoteTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

function buildHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Open an MCP client connection. Caller must `await client.close()` when
 * done — the connection holds an SSE stream open.
 */
export async function connectExternalMcp(config: ExternalMcpConfig): Promise<Client> {
  const token = config.tokenSealed ? openSealed(config.tokenSealed) : null;
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: buildHeaders(token) },
  });
  const client = new Client({ name: 'metu-conductor', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

/** List remote tools. Returns empty list and the underlying error on failure. */
export async function listRemoteTools(
  config: ExternalMcpConfig,
): Promise<{ ok: true; tools: RemoteTool[] } | { ok: false; error: string }> {
  let client: Client | null = null;
  try {
    client = await connectExternalMcp(config);
    const res = await client.listTools();
    const tools = (res.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return { ok: true, tools };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client?.close().catch(() => {});
  }
}

export async function callRemoteTool(
  config: ExternalMcpConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  let client: Client | null = null;
  try {
    client = await connectExternalMcp(config);
    const res = await client.callTool({ name: toolName, arguments: args });
    if (res.isError) {
      return {
        ok: false,
        error: JSON.stringify(res.content).slice(0, 500),
      };
    }
    return { ok: true, result: res.content };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client?.close().catch(() => {});
  }
}

/** Helper to seal a plaintext token before persisting. */
export function sealToken(token: string): Sealed {
  return seal(token);
}
