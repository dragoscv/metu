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
 * Reject URLs that point at loopback / link-local / private / metadata
 * services before opening an outbound MCP connection. The Conductor
 * dials this URL with the workspace's sealed bearer attached — a
 * malicious admin pointing it at `169.254.169.254` would otherwise leak
 * cloud-provider metadata.
 *
 * Mirrors `apps/web/src/lib/safe-equal.ts#assertSafeOutboundUrl` (kept in
 * sync deliberately — packages can't depend on apps).
 */
export function assertSafeMcpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid url');
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`unsupported protocol: ${protocol}`);
  }
  if (process.env.NODE_ENV === 'production' && protocol === 'http:') {
    throw new Error('only https:// is allowed in production');
  }
  const host = url.hostname.toLowerCase();
  const allowLocalhost = process.env.NODE_ENV !== 'production';
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0'
  ) {
    if (!allowLocalhost) throw new Error('loopback hosts are not allowed');
    return url;
  }
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224
    ) {
      throw new Error('private or reserved IP not allowed');
    }
  }
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1).toLowerCase();
    if (v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')) {
      throw new Error('private or reserved IPv6 not allowed');
    }
  }
  return url;
}

/**
 * Open an MCP client connection. Caller must `await client.close()` when
 * done — the connection holds an SSE stream open.
 */
export async function connectExternalMcp(config: ExternalMcpConfig): Promise<Client> {
  const safeUrl = assertSafeMcpUrl(config.url);
  const token = config.tokenSealed ? openSealed(config.tokenSealed) : null;
  const transport = new StreamableHTTPClientTransport(safeUrl, {
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
