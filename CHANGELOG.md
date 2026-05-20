# Changelog

> Auto-aggregated from Conventional Commits. The repo is pre-1.0; minor
> features ship inside grouped "batch" commits while architecture is in
> flux. We'll cut versioned releases once `apps/web` reaches its first
> tagged GA milestone.

## Unreleased (post `eed030a`)

### Marathon batch pass (Batches 7–21) — May 2026

> Fifteen sequential vertical-slice batches shipped behind the same north
> star: more agent reach + every surface (web / vscode / browser-ext /
> companion / mobile) earning a small useful capability per batch. Every
> batch verified `pnpm typecheck` (14/14) and `pnpm --filter @metu/web
exec vitest run` (124/124). End state: ~55 ACL-gated tools registered.

#### Agent tool surface (~8 → ~55 tools)

Every external-API mutating tool is `kind:'high_risk'` (default ACL `ask`);
read-only tools are `kind:'read'` and bypass approval. All routed through
`runTool()` in `packages/core/src/agent/policy.ts`.

- **Notion** (read + write): `notion_search`, `notion_get_page`,
  `notion_get_database`, `notion_query_database`, `notion_create_page`,
  `notion_append_block`, `notion_append_block_children`.
- **Slack** (read + write): `slack_search_messages`, `slack_list_channels`,
  `slack_list_users`, `slack_get_channel_history`, `slack_send_message`,
  `slack_update_message`, `slack_pin_message`, `slack_add_reaction`,
  `slack_open_dm`.
- **Google Calendar** (read + write): `gcal_list_events`, `gcal_get_event`,
  `gcal_list_calendars`, `gcal_freebusy`, `gcal_create_event`,
  `gcal_update_event`, `gcal_delete_event`, `gcal_quick_add`,
  `gcal_add_attendees`.
- **GitHub** (read + write): `github_get_pr`, `github_get_repo`,
  `github_get_commit`, `github_search_issues`, `github_list_releases`,
  `github_list_repos`, `github_list_workflow_runs`, `github_draft_pr`,
  `github_merge_pr`, `github_close_issue`, `github_create_issue`,
  `github_add_comment`, `github_pr_review_comment`, `github_request_review`,
  `github_add_label`, `github_assign`.
- **Linear** (read + write): `linear_get_issue`, `linear_get_viewer`,
  `linear_list_teams`, `linear_list_projects`, `linear_list_states`,
  `linear_create_issue`, `linear_move_issue`, `linear_assign_issue`,
  `linear_set_priority`, `linear_add_comment`.

Helpers added: `resolveIntegrationToken(workspaceId, integrationId, kind)`
in `packages/core/src/agent/tools.ts` consolidates the `openSealed` BYOK
flow for Slack / Linear / GCal / Notion. `resolveGithubToken` +
`octokitForToken` continue to wrap GitHub's installation-token flow.

#### Conductor + automation

- **Reactor** (`apps/web/src/inngest/functions/device-event-reactor.ts`):
  `'gentle' | 'aggressive'` activity-level branches that emit
  `conductor/notify` (low-urgency nudge) or `conductor/tick` + project-
  switch observe envelope. Aggressive branch generates tool-proposal
  notifications carrying `metadata.toolProposal` for one-tap approval.
- **`findRelevantProjects()`** (`conductor-proactive.ts`): 3-tier scoring
  (repo-match → name-substring → recency) with hint normalization for
  GitHub `owner/repo` shapes.
- **Pending tool-call approvals**: `respondToProposalAction` invokes
  `agent.runTool(...)` and persists `toolCallId` / `toolStatus` into
  `notification.metadata`. UI surfaces via `<ProposalActions>` and a new
  `/proposals` page.
- **Tool-call inspector**: `/agents/tool-calls/[id]` shows args / result /
  undoPayload / cost / error stack with an Undo button gated on
  `status==='success' && undoPayload`.
- **Auto-undo**: every mutating tool writes a `tool_call` row + matching
  `timeline_event`; `undoToolCallAction` reverses where supported.
- **ACL hardening**: `resolveAcl()` honors a `FORCE_ASK` set
  (`send_telegram`, `send_email`) and a monthly soft-brake that downgrades
  `autopilot` / `auto_with_undo` to `ask` once MTD spend crosses 50% of
  `workspace.monthlyCostCapUsd`. Proposals carry today/MTD budget snapshot.
- **Daily / weekly digests**: opt-in toggle stored in
  `agentPolicy.metadata.digestEmail` (defaults true). Subjects include
  open-proposal counts when > 0. Weekly digest prompt now feeds top-20
  ambient device-event kinds (counts only — no payloads).

#### Web app

- **New routes**: `/captures`, `/insights`, `/insights/export`,
  `/proposals`, `/agents/tool-calls/[id]`, per-repo
  `/integrations/github/[owner]/[repo]`.
- **Dashboard**: "Today's intelligence" + "Latest captures" + tag-cloud
  ("Top tags") cards.
- **Notifications**: snooze (15m / 1h / Tomorrow) + dismiss + project
  filter chips; `metadata.snoozedUntil` filters via raw `jsonb_set` and
  `(... ->> 'snoozedUntil')::timestamptz <= now()`.
- **Timeline**: tag-chip rows on each item, since-shortcut chips
  (All time / Today / 7d / 30d), tag filter via JSONB `?` operator,
  Reset filters link, `id="timeline-search"` + `<KeyboardFocus />`.
- **Audit**: tool-call detail expansion via `<DetailBlock>`,
  `id="audit-search"` + `<KeyboardFocus />`.
- **Captures**: kind/source/tag chip filters, today-count badge in
  PageHeader, search input, source-facet chip row, sourceUrl hostname
  preview, pagination via `cursor`, `id="captures-search"` +
  `<KeyboardFocus />`.
- **Projects**: `/projects/new` redesigned around "Git-repo first"
  (`<ProjectStarter>`) — search/create/paste-URL repo modal. New atomic
  `createProjectWithGithubRepoAction`. Per-page search input got
  `id="projects-search"` + `<KeyboardFocus />`.
- **About-me wizard**: AI-driven contextual profile builder backed by
  `memory_chunk(metadata.tag='profile')` rows. Uses new
  `generateStructured()` helper (Copilot-resilient — strips fences,
  re-parses, falls back to `generateText` with strict JSON system prompt).
- **Settings**: profile (display name / account deletion), billing
  (UsageCard 30d rollup, trial banner), notification prefs (mute sources +
  daily-digest opt-in), autonomy (global pause toggle, conductor activity
  level radio).
- **`/api/workspace/export`**: streaming NDJSON dump of 25 workspace-
  scoped tables (strips secret hashes / push tokens / embeddings / undo
  payloads, owner-only, rate-limited 2/30 min/user).
- **Reusable client helper**: `<KeyboardFocus targetId="..." />` —
  global `/` keypress focuses + selects the named input (skips when
  another field is already focused).

#### vscode-ext

- New commands: `metu.captureFile`, `metu.captureClipboard`,
  `metu.openWeb`, `metu.openTimeline`, `metu.openAudit`,
  `metu.openCapturesForWorkspace`.
- New menus: `editor/context` shows "Capture into metu" when
  `editorHasSelection`.
- New keybindings: `Ctrl/Cmd+Alt+M` capture, `Ctrl/Cmd+Alt+V`
  capture-clipboard, `Ctrl/Cmd+Alt+R` recall, `Ctrl/Cmd+Alt+A`
  companion-turn.
- Conductor backlog tree-view (slice 15 RR) with inline dismiss
  (`metu.dismissBacklogItem`) and status-bar count chip.
- Ambient sources: `onDidOpenTerminal` / `onDidCloseTerminal`,
  Git extension `repo.state.onDidChange` (`vscode.git.state` event with
  branch/dirty/ahead/behind/branchChanged), debounced
  `onDidChangeTextDocument` (`vscode.editor.text.changed`).

#### browser-ext

- Popup gained tags input (parsed `[,\s]+`, lowercased, validated
  `^[a-z0-9_-]{1,40}$`, max 10).
- `Ctrl/Cmd+Enter` from textarea submits the capture.
- `prefers-color-scheme: light` block in `popup.html` overrides all 8 CSS
  vars (Chromium 100+).
- Ambient capture (`content.js`): opt-in via
  `chrome.storage.local.{ambientCapture, ambientBlocklist}`. Ctrl+C of
  ≥12-char selection → `browser-ext.copy`. Form submit → field NAMES
  only (never values, never if any password field present).
- New permissions: `downloads`, `tabGroups`. Each wrapped in
  `if (chrome.X?.onY)` for soft-fail on browsers/profiles missing the
  API. Tab-group dedupe by `title|color|collapsed` signature.
- Options page: ambient-capture toggle + comma-separated host blocklist.

#### companion (Tauri)

- Voice capture (`useVoiceCapture.ts`) — `MediaRecorder`, multipart POST
  to `/api/sdk/v1/presence/transcribe`, then `client.capture(...)`. UI
  button + `CmdOrCtrl+Shift+V` global hotkey via
  `@tauri-apps/plugin-global-shortcut`. Last transcript with inline undo
  link (calls `DELETE /api/sdk/v1/capture/[id]`). Recent-transcripts
  panel with copy-to-clipboard.
- Awareness strip (`AwarenessStrip.tsx`) — receives `event.timeline`
  envelopes from other devices, dedupes by `kind+sourceDeviceId`, expires
  after 5min, shows distinct-device count + "last Xs ago".
- Pin-to-top toggle (`usePinToTop.ts`) — persistent
  `getCurrentWindow().setAlwaysOnTop(...)`.
- Mute-observer toggle (`useObserverMuted.ts`) — gates focus envelope +
  idle detection; cross-window via `storage` event.
- Idle detection (`useIdleDetection.ts`) — 5min inactivity →
  `device.companion.idle`, bump → `device.companion.active`.
- Footer additions: version line (`v{__APP_VERSION__}` wired via
  `vite.config.ts` `define`), shortcut hint, clickable apiBase link,
  "Reload" + "Open web" ghost buttons.
- Sensors panel (opt-in window/clipboard/file-watcher controls).

#### mobile (Expo Router)

- Brain-dump screen: live `#hashtag` chip preview (regex
  `/#([a-z0-9_-]{1,40})/gi`, lowercased, deduped, max 10), attached as
  `metadata.tags` on capture. Photo-capture flow inherits the same tags.
- Share-intent extended: `metu://share?text=&url=&title=&image=`. URL
  fires fire-and-forget `kind:'link'` capture; image URL detected via
  `IMG_RE = /\.(png|jpe?g|gif|webp|heic|heif)(\?|$)/i` → `kind:'image'`
  with `sourceUrl`.
- Voice + photo capture buttons; Android `intentFilters` for SEND
  text/plain + SEND image/\* + VIEW `metu://share`.
- "Open metu on web →" link, "Last captured Xm ago" footer, conditional
  "Clear" button.

#### Hardening + observability

- `@metu/logger` exports `initNodeSentry()` (dynamic-imported so
  `@sentry/node` stays an optional peer); hub / worker / mcp-server
  wire it at boot.
- Hub `device-event` route fans out cross-device `event.timeline`
  envelopes after timeline insert (best-effort, `void … .catch(() => {})`).
- Push notifications gated by urgency: only `high` / `critical` reach
  Expo / web push; `low` / `normal` stay in-app + WS.
- New SDK routes: `DELETE /api/sdk/v1/capture/[id]`,
  `POST /api/sdk/v1/transcribe`, `POST /api/sdk/v1/tools/decision`,
  `POST /api/sdk/v1/push/register`. All bearer-scoped, all triple-
  workspace-scoped on writes.
- Server-side platform syncs: notion / stripe / vercel cron functions
  with shared `markIntegrationSyncSuccess` / `markIntegrationSyncError`
  helpers. `sync-failure-recorder.ts` listens on
  `'inngest/function.failed'` so per-platform handlers don't re-import
  the error helper.
- Integration stale detector cron `*/30 * * * *`: per-kind MAX_GAP_MS
  thresholds, prefixes `lastError` with `stale_sync:` to avoid alert
  spam, sends `conductor/notify` urgency `'low'` to workspace owner.
- `actions-guard.test.ts` enforces every `db.update(/db.delete(` site
  mentions `workspaceId` within 600 chars; new tests cover protocol
  schema round-trips and OAuth helpers (36 new tests).

#### Recurring gotchas captured during the marathon

- **Drizzle 0.36**: `.returning({...projection})` typing breaks. Use
  `.returning()` no-arg.
- **`timeline_event.occurredAt`** (not `createdAt`); Drizzle aggregate
  `count()` returns string-ish — wrap with `Number(r.n ?? 0)`.
- **`ToolKind`** is 3-valued: `'read' | 'low_risk' | 'high_risk'` — no
  `'medium_risk'`.
- **`@metu/ui` Badge variants**: `success | warning | danger | info |
neutral | brand | outline` — no `muted`.
- **`@metu/ui` Button variants**: `default | ghost | outline | subtle |
danger` — no `primary` / `secondary` / `asChild`. Use plain `<a>` with
  utility classes for link-styled buttons.
- **`integrationKind`** enum uses `'gcal'` (not `'google_calendar'`).
- **Slack**: bearer auth + `application/json; charset=utf-8`. Linear
  GraphQL: `authorization: token` (NO Bearer). Notion: `Bearer ${token}`
  - `notion-version: 2022-06-28`.
- **Slack `conversations.open`** body takes `users: ids.join(',')` —
  comma-joined string, not an array.
- **`'use server'` files** cannot export non-async values. Keep zod
  schemas module-private; export only types + async functions.
- **`zod.default('')`** makes a field optional in INPUT but required in
  OUTPUT. Use `z.input<typeof schema>` for action signatures or pass
  defaults explicitly.
- **Two `jsonb_set` updates** targeting the same column should be issued
  as separate `update().set({metadata: jsonb_set(...)})` calls — chaining
  in a single `.set({})` keeps only the last value.
- **vscode-ext commands**: BOTH `extension.ts` `registerCommand` AND
  `package.json` `contributes.commands` are required — missing the
  latter hides it from the command palette.
- **Nested `<Link>`** is invalid HTML. Place inner clickable regions as
  siblings inside the same `<li>` / `<motion.li>`.
- **`KeyboardFocus`** target id MUST exist at first paint; conditionally-
  rendered inputs need a fallback or eager render.
- Pure server-component pages can't host `keydown` listeners — that's
  why `<KeyboardFocus>` is a tiny `'use client'` component that does
  nothing on render and only wires `window.addEventListener('keydown')`.

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
