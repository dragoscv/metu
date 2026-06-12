# Ecosystem research — June 2026

Deep-research pass on the agent-OS / MCP landscape, with actionable
recommendations for metu ranked by ROI. Companion to the 2026-06-12 audit
(see `/memories/repo/metu-master-decisions.md`).

## Landscape snapshot

- **MCP is the de-facto standard.** Anthropic donated MCP to the Agentic AI
  Foundation; ecosystem reports cite 10K+ public servers and ~97M monthly SDK
  downloads. Every major client (Claude Desktop, VS Code, Cursor, ChatGPT
  desktop) ships MCP support. Streamable HTTP (2025-03-26 spec) is the
  winning transport — which metu's `apps/mcp-server` already implements.
- **Agentic AI is Gartner's #1 2026 trend** — but the practical bar moved
  from "can call tools" to _trust infrastructure_: audited tool calls,
  scoped permissions, earned autonomy. metu's ACL/audit design
  (observe → ask → auto-with-undo → autopilot) is ahead of most of the
  market here; this is the moat to deepen, not replace.
- **Prompts + resources are the under-used MCP surfaces.** Clients now
  render server-provided prompts as slash commands. Most servers expose
  only tools; exposing curated workflow prompts is cheap differentiation.
- **Agent memory consolidation** (episodic/semantic/procedural distillation)
  has become standard architecture in the literature — metu's nightly
  consolidation cron matches it; the next frontier is _retrieval-time
  weighting_ (recency × type × confidence) rather than more storage.

## Recommendations (ranked)

| #   | Recommendation                                                                                                                                                                        | ROI  | Effort | Status                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------- |
| 1   | Expose MCP **prompts** (resume-work, capture-thought, daily-review)                                                                                                                   | High | S      | ✅ shipped this pass                                    |
| 2   | Keep hardening the **audit/approval moat** — surface approval queues in every client (companion, mobile push actions already exist)                                                   | High | M      | ongoing                                                 |
| 3   | MCP **resources**: expose read-only briefing/timeline as `metu://` resources so clients can attach context without a tool call                                                        | Med  | M      | ✅ shipped (`metu://projects`, `metu://timeline/today`) |
| 4   | **OAuth for MCP**: the spec's auth story converged on OAuth 2.1 + PKCE; metu's provider already supports it — wire `/mcp` to accept it as an alternative to `metu_at_*` bearer tokens | Med  | M      | follow-up                                               |
| 5   | Retrieval-time memory weighting (boost consolidation-origin chunks, decay raw captures in ranking, not just deletion)                                                                 | Med  | M      | follow-up                                               |
| 6   | Publish the MCP server config to client registries (Claude Desktop extensions dir, VS Code MCP gallery) once hosted endpoint is stable                                                | Med  | S      | follow-up                                               |
| 7   | Watch: A2A / agent-to-agent protocols — nothing to adopt yet; revisit Q4 2026                                                                                                         | Low  | —      | watch                                                   |

## What we deliberately did NOT adopt

- **LangGraph / orchestration frameworks** — metu's planner + Inngest
  step functions already cover plan-and-execute durably; adding a graph
  framework would duplicate Inngest's persistence with worse audit hooks.
- **Vector-DB migration** — pgvector + HNSW remains the right call at this
  scale; dedicated vector stores add ops burden with no recall win.
- **A2A protocols** — too early; no interoperable consumers.

## Shipped in this pass (2026-06-12)

- MCP prompts capability (`apps/mcp-server`): `resume-work`,
  `capture-thought`, `daily-review` — server version bumped to 0.5.0.
- See the audit log in repo memory for the security/reliability/perf items.
