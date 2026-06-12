# MCP server

`apps/mcp-server` exposes the full Conductor tool registry over the
Model Context Protocol so any MCP client (Claude Desktop, VS Code,
Cursor, ChatGPT desktop) can drive metu. Every tool call goes through
`runTool()` — workspace ACL, audit rows, cost meters, and recursion
limits apply identically to in-app agent runs.

## Transports

| Transport       | How                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------- |
| stdio           | `pnpm --filter @metu/mcp-server start` (local dev, single token via `METU_TOKEN`)               |
| Streamable HTTP | `/mcp` endpoint (Cloud Run). One session per client; sessions pin to the auth that opened them. |

## Auth

Two ways to authenticate:

1. **OAuth 2.1 discovery (recommended, spec-compliant clients).**
   The server publishes RFC 9728 metadata at
   `/.well-known/oauth-protected-resource` and points at the web app's
   authorization server (RFC 8414 metadata at
   `/.well-known/oauth-authorization-server`). Clients run the
   authorization-code + PKCE flow and get a `metu_at_*` bearer token
   scoped to the consenting user + workspace.
2. **Manual token.** Mint a token in the web app under `/apps`
   ("Mint token") and configure it as a bearer header.

Required scopes per capability:

| Capability       | Scope                              |
| ---------------- | ---------------------------------- |
| `tools/call`     | `tools:invoke` (plus per-tool ACL) |
| `resources/read` | `recall:read`                      |
| `prompts/get`    | none (static templates)            |

## Capabilities

- **Tools** — the whole Conductor registry (80+ tools across tasks, projects,
  GitHub, Linear, Slack, Notion, Google Calendar, devices, editor).
  Side-effecting calls return `awaiting_approval` + an audit URL when the
  workspace ACL says `ask`.
- **Resources** (read-only, attachable context):
  - `metu://projects` — active projects with status + momentum.
  - `metu://timeline/today` — last 24h of timeline events (max 50).
  - `metu://briefing` — latest continuity briefing per active project.
- **Prompts** — slash-command templates for common workflows
  (morning brief, project catch-up, etc.).

## Client config examples

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "metu": {
      "type": "http",
      "url": "https://mcp.metu.ro/mcp"
    }
  }
}
```

Claude Desktop (`claude_desktop_config.json`, stdio with manual token):

```json
{
  "mcpServers": {
    "metu": {
      "command": "node",
      "args": ["<repo>/apps/mcp-server/dist/index.js"],
      "env": { "METU_TOKEN": "metu_at_..." }
    }
  }
}
```

## Env vars (server)

| Var                   | Purpose                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `METU_WEB_URL`        | Base URL of the web app (token resolution + discovery metadata)                |
| `METU_MCP_PUBLIC_URL` | Public URL of this server (RFC 9728 `resource` field); defaults to `<web>/mcp` |
| `MCP_HTTP_PORT`       | Enables the HTTP transport                                                     |
| `METU_TOKEN`          | stdio-mode single token                                                        |
