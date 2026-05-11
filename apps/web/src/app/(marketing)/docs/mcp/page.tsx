/**
 * /docs/mcp — Model Context Protocol bridge.
 */
export const dynamic = 'force-static';
export const revalidate = 3600;

export default function DocsMcpPage() {
  return (
    <article className="prose prose-invert max-w-none">
      <h1>Model Context Protocol (MCP)</h1>
      <p className="text-[var(--color-fg-subtle)]">
        metu speaks MCP both as a server (Claude Desktop, Cursor, and other MCP clients can call
        metu's recall / capture / brief tools) and as a client (consume any MCP server you connect).
      </p>

      <h2>As an MCP server</h2>
      <p>
        Run <code>apps/mcp-server</code> via stdio or hosted HTTP. The server exposes the same tools
        as the SDK (<code>capture</code>, <code>recall</code>, <code>resume</code>,{' '}
        <code>brief</code>, <code>notify</code>) authenticated with your bearer token.
      </p>

      <h2>Configuration for Claude Desktop</h2>
      <pre>
        <code>{`{
  "mcpServers": {
    "metu": {
      "command": "npx",
      "args": ["-y", "@metu/mcp-server"],
      "env": {
        "METU_API_URL": "https://app.metu.ro",
        "METU_TOKEN": "metu_at_…"
      }
    }
  }
}`}</code>
      </pre>

      <h2>As an MCP client</h2>
      <p>
        Connect a third-party MCP server on <a href="/integrations">/integrations</a> → MCP. The
        Conductor surfaces the server's tools through the standard tool-policy gate (observe / ask /
        auto-with-undo / autopilot).
      </p>
    </article>
  );
}
