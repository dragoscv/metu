# Changelog

> Auto-aggregated from Conventional Commits. The repo is pre-1.0; minor
> features ship inside grouped "batch" commits while architecture is in
> flux. We'll cut versioned releases once `apps/web` reaches its first
> tagged GA milestone.

## Unreleased (post `eed030a`)

### Audit & polish pass — May 2026

- **test(protocol,auth):** zod schema round-trips for `Hello`, `HelloAck`,
  `ServerEvent`, `ClientEvent`, `CaptureCreate`, `RecallQuery`,
  `NotifyCreate`, `IntentCreate`; OAuth helper coverage for
  `parseScopes`, `scopesAllowed`, `hashToken`/`compareSecret`,
  `verifyPkce`, `randomToken`, `generateUserCode`, `TTL`. 36 new tests.
- **feat(logger,hub,worker,mcp-server):** `@metu/logger` exports
  `initNodeSentry()` — dynamic-import-guarded so `@sentry/node` stays an
  optional peer. hub / worker / mcp-server wire it at boot.
- **feat(web,core,docs):**
  - `/settings/profile` gains display-name editing and account-deletion
    forms (sole-owner workspaces block deletion); the "Coming soon" card
    is replaced with a focused roadmap note.
  - `/api/workspace/export` rewritten as streaming NDJSON
    (`{table, row}` lines, 25 workspace-scoped tables, strips secret
    hashes / push tokens / embeddings / undo payloads, owner-only,
    rate-limited 2/30 min/user).
  - `resolveAcl()` gains a hard `FORCE_ASK` set (`send_telegram`,
    `send_email`) and a monthly soft-brake that downgrades
    `autopilot`/`auto_with_undo` to `ask` once MTD spend crosses 50% of
    `workspace.monthlyCostCapUsd`. Proposal notifications + timeline
    rows now carry a today/MTD budget snapshot.
  - Docs cleanup: `apps/desktop` → `apps/companion`,
    `security.instructions.md` webhook-secret paragraph reflects the
    hashed state, master-plan slice table updated.

### Earlier (selected highlights from the daily batches)

- `eed030a` notification mutations scoped by `workspaceId`; guard test tightened.
- `ab973e5` filter-aware mark-all-read for notifications.
- `1b5212d` audit toolbar Today / Last 7d quick presets.
- `a0717ab` dashboard cost-budget banner + notifications source filter.
- `f0349fe` memory bulk-delete + inline sidebar resume button.
- `8171109` pause-autonomy toggle on dashboard, top-sources card on timeline.
- `488e0b1` workspace rename, notifications page, hub DLQ discard.
- `4dbae51` recall webview, autonomy preset, capture toast (vscode-ext + browser-ext).
- `0e6d542` recent decisions panel on `/review`.
- `5dbe5ed` `/review` page with 7/14/30-day window selector.
- `4797ed0` `seedDemoDataAction` + Try sample project CTA.
- `857aeb8` recall panel mode toggle + recent searches chips.
- `9ce9a6a` agent-run tile on `/audit` (status counts + spend).
- `c49ef6f` `POST /api/sdk/v1/brief` + Regenerate command (sdk + vscode-ext).
- `f8737d7` `/resume` — the north-star 3d/3w/3m continuity surface.
- `7d18c55` companion `device.ollama_chat` tunnel for local LLMs.
- `2b7a4a8` companion clipboard ring buffer with one-tap capture.
- `60caaa3` 6 high-risk mutating agent tools registered.

## v0.1.0 — Initial monorepo (`9573789`)

Initial scaffold of the metu monorepo — Next.js 16 web app, Hono+ws hub,
Cloud Run worker, Tauri companion, mobile, browser/vscode extensions,
shared packages (`@metu/ai`, `@metu/auth`, `@metu/core`, `@metu/db`,
`@metu/integrations`, `@metu/logger`, `@metu/presence`, `@metu/protocol`,
`@metu/sdk`, `@metu/types`, `@metu/ui`, `@metu/voice`).
