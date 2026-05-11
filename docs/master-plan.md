# METU — Master Plan: Central Console for the Second Brain

> Status: living doc. Author: Dragos. Decisions locked 2026-05-06.
> Scope: turning METU from a passive second-brain into a **continuously-running, autonomous-yet-supervised, multi-device control plane** for every app in the constellation (notai, mmo, future apps).

---

## 1. Why this exists

You don't need another dashboard. You need a **co-pilot that watches everything you do across every app and device, remembers, decides what matters, and either acts or asks you to**.

The bar:

- After 3 days / 3 weeks / 3 months — METU knows where you left off, what changed in every connected app, and the next minimum-viable step.
- Every app you build (notai, mmo, …) signs in _with METU_ and reports its events to METU. METU is the identity provider, the memory, the conductor.
- One desktop companion app on Win/Mac/Linux gives the assistant a hand to capture, watch, and notify — natively.

---

## 2. The four new layers (on top of the existing four engines)

```
                                ┌────────────────────────────────┐
                                │     Memory · Project · Focus    │  (existing)
                                │           Continuity            │
                                └─────────────┬───────────────────┘
                                              │
                ┌─────────────────────────────┴─────────────────────────────┐
                │                                                           │
        ┌───────▼────────┐    ┌────────────────────┐    ┌──────────────────▼───┐
        │   CONDUCTOR    │    │   CONVERSATIONS    │    │   AUTONOMY POLICY    │
        │  (supervisor)  │◀──▶│  (sessions+chat)   │    │  (per-tool ACLs)     │
        └───────┬────────┘    └────────────────────┘    └──────────────────────┘
                │
        ┌───────▼─────────────────────────────────────────────────────────────┐
        │                   PROTOCOL  (cross-app + cross-device)               │
        │   OAuth2/OIDC provider · @metu/sdk · WS hub · webhooks · MCP         │
        └───────┬─────────────────────────────────────────────────────────────┘
                │
        ┌───────▼─────────┐    ┌────────────────────┐    ┌────────────────────┐
        │     DEVICES     │    │     APPS           │    │   NOTIFICATIONS    │
        │ web · mobile ·  │    │ notai · mmo · …    │    │ webpush · expo ·   │
        │ tauri · vscode  │    │ third-party        │    │ tauri native       │
        └─────────────────┘    └────────────────────┘    └────────────────────┘
```

### 2.1 Conductor — the always-on supervisor

A long-running Inngest durable function (`conductor.tick`) per workspace that:

- subscribes to every `timeline_event`, `device_event`, `app_event`;
- on each tick decides: **observe / draft / ask / act / notify / idle**;
- routes through `getModel({ intent: 'agentic' })`;
- bounded by per-tool ACL + per-day cost cap (`workspace.monthlyCostCapUsd` extended with `dailyActionCap`); workspace can opt into `unlimited_ai`;
- writes every step into `agent_run` + `tool_call` for full audit;
- cooperates with Conversations: it talks in the persistent Conductor thread by default; user can branch a side chat and the Conductor follows that thread's intent.

Loop pattern:

```ts
inngest.createFunction(
  { id: 'conductor-tick', concurrency: { key: 'event.data.workspaceId', limit: 1 } },
  { event: 'conductor/tick' },
  async ({ event, step }) => {
    const ctx = await step.run('gather', () => gatherContext(event.data.workspaceId));
    const plan = await step.run('plan', () => llmPlan(ctx)); // structured output
    for (const action of plan.actions) {
      const acl = await step.run('acl', () => resolveAcl(action));
      if (acl === 'ask') {
        await step.run('ask', () => postMessage(action.prompt, ctx));
        await step.waitForEvent('approval', {
          event: 'conductor/approved',
          timeout: '24h',
          if: `data.actionId == "${action.id}"`,
        });
      }
      if (acl !== 'observe') await step.run('exec', () => execute(action));
    }
    await step.sleepUntil('next', plan.nextTickAt);
    await step.sendEvent('next', {
      name: 'conductor/tick',
      data: { workspaceId: event.data.workspaceId },
    });
  },
);
```

### 2.2 Conversations — first-class sessions

Schema:

- `conversation` — one persistent **Conductor thread** per workspace + N user-created **side chats** + auto-created **project chats**.
- `message` — role: user/assistant/tool/system; content blocks; streaming-friendly.
- `tool_call` — every tool invocation with args, result, status, latency, cost — links back to `agent_run` and `message`.

UX:

- `/dashboard/conductor` — the persistent thread, always available.
- Side-rail of side chats grouped by project.
- View Transitions on switch; framer-motion on message stream.
- Slash commands (`/recall`, `/decision`, `/focus`, `/notify`, `/act`).
- **Promote** a side chat → project thread; convert messages → captures/decisions/tasks.

### 2.3 Autonomy policy — tunable, per-tool

Schema:

- `agent_policy` (per workspace): default mode (observe | ask | auto-with-undo | autopilot), daily cost cap, daily action cap, quiet hours, notification slider (0..100).
- `tool_acl` (per workspace × tool name): override the default.

Tools registered centrally in `packages/core/agent/tools.ts`:

- read-only: `recall`, `list_projects`, `list_tasks`, `read_capture`, `repo_summarize`.
- mutating-low-risk: `tag_capture`, `summarize_project`, `create_task_draft`, `propose_decision`.
- mutating-high-risk: `send_telegram`, `send_email`, `commit_file`, `merge_pr`, `charge_stripe`, `delete_*`.

Defaults: read-only=auto, low-risk=auto-with-undo, high-risk=ask. Undo log via `tool_call.undo_payload`.

### 2.4 Protocol — how the world talks to METU

**Three surfaces, one identity.**

1. **OAuth2/OIDC provider mode** — METU issues access/refresh tokens to first-party apps (notai, mmo) and third-parties. Auth.js v5 + a thin custom OIDC layer (we expose `/oauth/authorize`, `/oauth/token`, `/oauth/userinfo`, `/.well-known/openid-configuration`).
2. **`@metu/sdk`** — typed client (TS-first; later: Python, Rust). Methods: `auth()`, `capture()`, `recall()`, `notify()`, `registerDevice()`, `openConversation()`, `event()`, `subscribe()`. Internally uses the OAuth token + `@metu/protocol` zod schemas + WS for live events.
3. **WS hub** (new service `apps/hub`) — persistent WebSocket gateway for devices and client apps. hono + `@hono/node-ws` on Cloud Run. Auth = OAuth bearer. Routes:
   - `/v1/connect` — upgrade to WS, identifies device or app
   - server→client: `event.timeline`, `event.notification`, `tool.invoke`, `command`
   - client→server: `event.app`, `event.device`, `tool.result`, `presence`

MCP server stays for AI clients (Claude/Cursor/Copilot) — independent of the hub.

Webhooks: signed (HMAC) inbound endpoints `/api/webhooks/:appSlug` for apps that can't keep a WS open.

### 2.5 Devices — every endpoint that runs you

Schema:

- `device` (workspace_id, user_id, kind, platform, fingerprint, name, push_token, last_seen_at, presence, acl, revoked_at).
- `device_event` (append-only log of pings, presence transitions, tool invocations).

Kinds: `web`, `mobile`, `vscode_ext`, `browser_ext`, `companion_desktop`, `mcp_client`, `external_app`.

Pairing flows:

- **OAuth2 device-code flow** — companion + CLI. User sees a code, approves on web.
- **QR pairing** — mobile ↔ desktop on same LAN.
- **mDNS auto-discovery** — companion broadcasts `_metu._tcp.local`; web app on same network can offer to pair.

Page: `/dashboard/devices` — live grid: name, platform icon, last seen, presence dot, current activity ("watching ~/code/notai"), tool ACL pill, revoke button.

### 2.6 Apps — METU as the central console

Each first-party (notai/mmo) and third-party app is an `app_registration`:

- `oauth_client` (client_id, client_secret_hash, redirect_uris, allowed_scopes, type: first_party | third_party).
- `app_registration` (workspace_id, oauth_client_id, name, slug, icon, default_scopes, webhook_url, status).
- `app_event` is just `timeline_event` with `kind = 'app.*'` — no extra table.

Page: `/dashboard/apps` — list of installed apps with capabilities, recent events, revoke, and "what this app sees" transparency panel.

### 2.7 Notifications — silent → ambient → assertive

Schema:

- `notification` (id, workspace_id, user_id, title, body, urgency 0..1, source, action_url, sent_to[], acknowledged_at).
- `notification_subscription` — channel-specific tokens: `web_push` (VAPID endpoint+keys), `expo_push` (token), `tauri` (handled via WS, not stored).

Routing rule: pick the channel with the **highest presence** (active device first), respect quiet hours, respect slider.

UI: mission-control toast tray (sonner) + an `/dashboard/notifications` history page.

---

## 3. Companion desktop app — Tauri v2

`apps/desktop` (new). Stack:

- Rust core + React UI (re-uses `packages/ui`).
- Tauri v2 plugins: tray, notifications, global-shortcut, autostart, single-instance, deep-link, http, store, sql (sqlite), updater, fs (scoped).

V1 features (all locked in):

1. **Global hotkey capture** — Cmd/Ctrl+Shift+Space → quick capture (text/voice/screenshot) → `@metu/sdk.capture()`.
2. **Tray** — shows "now" task; click to expand mini Conductor view.
3. **OS-native notifications** — via Tauri notification plugin; clicks deep-link to web.
4. **Active-window tracking (opt-in)** — Rust `active-win-pos-rs`; emits `device.window_changed` over WS; redacted titles via local rules.
5. **Clipboard history (opt-in)** — Rust `arboard`; local SQLite ring buffer; explicit "remember this" promotes to capture.
6. **File watcher (opt-in)** — Rust `notify` crate; user-chosen folders; emits `device.file_changed`.
7. **Wake-word** — porcupine (free tier) wake word "hey metu" → records short utterance → uploads to METU transcribe.
8. **Local LLM bridge (Ollama)** — companion exposes localhost:11434 to METU via WS tunnel so cloud workflows can use local models when user is offline-first.

Auto-update via Tauri updater (signed bundles published to GCS).

---

## 4. Apps integration — first-party (notai, mmo) recipe

For any app `X`:

1. `pnpm add @metu/sdk` in `X`.
2. In METU `/dashboard/apps` → "Register app" → get `client_id` + `client_secret`.
3. In `X`, configure NextAuth/Auth.js with METU as a custom OIDC provider (issuer `https://app.metu.ro`).
4. Replace internal `track()` / `notify()` calls with `metu.event(...)` / `metu.notify(...)`.
5. Optional: open a WS in a server-side worker so METU can push tool invocations _into_ `X` (e.g. "create note in notai about this decision").

Net effect: notai becomes a memory-aware editor; mmo becomes a memory-aware game. METU is their shared identity, memory, and command surface.

---

## 5. UI/UX direction

- **Home** stays brutally simple: now / next / ignore. Don't change it.
- **Persistent Conductor strip** at the bottom of every page (Linear-style) — collapsible, shows last assistant message + a quick reply.
- **Command palette** (cmdk) — universal entry to recall, capture, switch project, run tool.
- **View Transitions API** for route morphs.
- **framer-motion** for: focus reveal, message stream, tool-call expand/collapse, device pulse.
- **Sonner** toasts for notifications.
- **Tailwind v4 `@theme`** — single token system across web + companion + mobile.

---

## 6. Vertical slices (delivery order)

| #   | Slice                                  | Includes                                                                                                                                                     | Status      |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 0   | Master plan + schema + scaffolding     | this doc, db migrations (0000–0022), empty packages, conductor                                                                                               | **shipped** |
| 1   | Conversations + Conductor (web only)   | UI, streaming chat, tools, autonomy, audit, planner+repair                                                                                                   | **shipped** |
| 2   | OAuth2 provider + @metu/sdk + protocol | OIDC endpoints (authorize/token/userinfo/jwks/.well-known/device), sdk, hub                                                                                  | **shipped** |
| 3   | Devices + notifications                | device pages, web push (VAPID), expo push, presence, hub fanout                                                                                              | **shipped** |
| 4   | Companion desktop app v1               | Tauri scaffold, capture+tray+notifs, OAuth device-flow pairing                                                                                               | **shipped** |
| 5   | Watchers fan-out                       | github+gcal+gmail+stripe+telegram → timeline_event → conductor/observe                                                                                       | **shipped** |
| 6   | Companion advanced (v1.5)              | window tracking, clipboard, file watcher, wake-word, Ollama tunnel                                                                                           | next        |
| 7   | notai + mmo wired up                   | both apps consume @metu/sdk, register as OAuth clients                                                                                                       | scaffolding |
| 8   | UI polish                              | command bar (cmdk + slash incl. /tool), conductor strip + spend gradient, view transitions                                                                   | **shipped** |
| 9   | Hardening pass                         | SSRF/SSRF (registerApp), token-length floor, hub clientId binding, ON CONFLICT upserts, prod-required env hard-errors, idempotent migrations, Sentry install | **shipped** |

Each slice is end-to-end (schema → server → UI → tests) and shippable.

---

## 7. Anti-goals (still in force)

- ❌ Generic chatbot UI as the front door of METU.
- ❌ A widget-soup dashboard.
- ❌ Full autopilot before the supervised loop is rock-solid.
- ❌ A new integration unless it closes a real loop.
- ❌ Adding capabilities to the companion app that aren't opt-in.

---

## 8. Open follow-ups (will revisit)

- Mobile push: Expo push tokens only valid on EAS dev/build — confirm we need EAS Production credentials early.
- Local LLM bridge security: Ollama tunnel must require explicit per-call user approval (default).
- Wake-word privacy: must be **fully local** — no audio leaves the device until after user confirms transcript.
- Cost: per-tool dollar cost shown in the Conductor message that proposes the action.
