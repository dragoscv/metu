# metu — Architecture

> An external operating system for executive function. Its job is to **reduce the decision space**, not expand it.

## North Star

> _"After 3 days, 3 weeks, or 3 months — metu knows where I left off, why, and the next minimum-viable step."_

Every architectural decision below is judged against that sentence.

---

## High-level system

```
                       ┌────────────────────────────────────────┐
                       │              SURFACES                   │
                       │  Web · Mobile · VS Code · Browser · MCP │
                       └────────────────┬───────────────────────┘
                                        │ tRPC-style typed RPC + REST webhooks
                       ┌────────────────▼───────────────────────┐
                       │        EDGE / API   (Next.js 16)        │
                       │  Auth · BYOK vault · capture · queries  │
                       └─────┬──────────────┬──────────────┬────┘
                             │              │              │
              ┌──────────────▼──┐   ┌───────▼──────┐  ┌────▼────────┐
              │  Postgres+pgvec │   │   Upstash    │  │   GCS       │
              │  (Neon)         │   │   Redis      │  │  audio/img  │
              └──────────────┬──┘   └───────┬──────┘  └────┬────────┘
                             │              │              │
                       ┌─────▼──────────────▼──────────────▼────┐
                       │              ENGINES                    │
                       │  Memory · Project · Focus · Continuity  │
                       └─────┬──────────────────────────────────┘
                             │ Inngest events
                       ┌─────▼─────────────────────────────────┐
                       │        WORKER  (Cloud Run)             │
                       │ embeddings · transcribe · agents · sync│
                       └─────┬─────────────────────────────────┘
                             │
                       ┌─────▼─────────────────────────────────┐
                       │          AI PROVIDER MESH              │
                       │  Anthropic · OpenAI · Azure · Gemini   │
                       │  Copilot (via vscode-ext) · Ollama     │
                       └────────────────────────────────────────┘
```

---

## Core domain model

Everything is scoped to a `workspace` (multi-tenant from day 1). A user can belong to N workspaces.

```
user ──────┬──── workspace_member ────┬──── workspace
           │                          │
           └──────────────────────────┘
                                      │
              ┌─────────────┬─────────┼─────────┬──────────────┐
              ▼             ▼         ▼         ▼              ▼
          project       capture     task    decision       integration
              │             │         │         │              │
              ├── memory_chunk (vector)  ◄──────┘              │
              │             │                                  │
              └─── timeline_event ──────────────────────────────┘
```

### Key entities

| Table                 | Purpose                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `workspace`           | Tenant root. Has BYOK provider credentials, encryption settings.                                                       |
| `workspace_member`    | User ↔ workspace with role (owner/admin/member).                                                                       |
| `project`             | A unit of work — a product, repo, client, life area. Has stack, goals, momentum_score.                                 |
| `capture`             | Raw input: text, voice (→ transcript), screenshot, link, code paste. Universal inbox.                                  |
| `task`                | Actionable item with status, leverage_score, blocked_reason. AI-suggested or user-created.                             |
| `decision`            | Logged decision with rationale + alternatives — _the_ secret weapon for context restore.                               |
| `memory_chunk`        | Embedded text chunk with metadata. Polymorphic source (capture/task/decision/repo file/email/etc). 1536-dim vector.    |
| `timeline_event`      | Append-only event log: every meaningful action. Source of truth for "what happened when".                              |
| `integration`         | Per-workspace connector instance (github_repo, gmail, calendar, telegram_chat, stripe_account…) with encrypted tokens. |
| `provider_credential` | BYOK: encrypted API keys per AI provider per workspace.                                                                |
| `agent_run`           | One execution of an agent chain — prompt, tools used, cost, outcome. Auditable.                                        |
| `focus_state`         | Current focus snapshot per user — what's "now", what's "ignored this week", energy_level.                              |

All tables have `created_at`, `updated_at`, soft `deleted_at`, and `workspace_id` (except user/auth tables).

---

## The Four Engines

### 1. Memory Engine (`packages/core/memory`)

**Job:** ingest anything, retrieve by intent.

- **Ingest pipeline** (Inngest): `capture.created` → chunk (semantic split, ~512 tokens) → embed (default `text-embedding-3-small`, 1536 dims) → write `memory_chunk` rows → emit `memory.indexed`.
- **Retrieval API:** `recall(query, { project?, timeRange?, kinds?, k=10 })` — hybrid search: pgvector cosine + Postgres FTS, then re-rank by recency × project-affinity × decision-weight.
- **Episodic vs semantic vs timeline:**
  - _Episodic_ = "what happened" → `timeline_event` + `capture`.
  - _Semantic_ = "what do I know" → embedded chunks across all sources.
  - _Timeline_ = projection — given a time range, hydrate all relevant events with summary.

### 2. Project Intelligence (`packages/core/project`)

**Job:** keep each project's state alive without manual upkeep.

For each project, derived continuously by background jobs:

- `momentum_score` ∈ [0,1] = decayed weighted sum of (commits + captures + tasks_done + decisions) over last 30d.
- `last_meaningful_activity` (not last_seen — actual progress signal).
- `stack_summary` (auto-extracted from repo when GitHub linked).
- `open_blockers` (tasks with `blocked_reason` set, ranked by age).
- `revenue_signal` (Stripe events tagged to project).
- `state_summary` — LLM-generated 3-sentence pulse refreshed daily.

### 3. Focus Engine (`packages/core/focus`)

**Job:** tell you what NOT to do. The hardest part.

Algorithm (runs on demand + nightly):

```
input:  all active projects, captures last 14d, tasks, energy_level, calendar
output: { now: Task, next: Task[], ignore_this_week: Project[], rationale: string }
```

Heuristics combined with LLM:

1. **Leverage rank** — for each open task: `expected_value × shipping_proximity × user_energy_match / context_switch_cost`.
2. **Death detection** — projects with momentum_score < 0.1 for 21d → "kill or commit?" prompt.
3. **Decision-space reduction** — LLM forced to output exactly 1 _now_, ≤3 _next_, and ≥1 _explicit ignore_. JSON-schema constrained.
4. **Energy match** — if user marked low energy, prefer "shallow" tasks (admin, review) over "deep" (architecture, new code).

Output stored in `focus_state` and surfaced as the home dashboard.

### 4. Context Continuity (`packages/core/continuity`)

**Job:** "where was I?" in <2 seconds.

- On every `vscode-ext` close + every git commit + every "session end" event → snapshot:
  - active project, open files, last 5 prompts, current branch + diff summary, last decision.
- `restore(projectId)` → returns: opening narrative ("3 days ago you were debugging X, decided Y, next step was Z"), reopens VS Code workspace + relevant docs, primes agent with last context.

---

## Multi-provider AI (BYOK) — the OpenClaw-style mesh

`packages/ai` exposes a single `getModel({ workspaceId, intent })` that routes to the best available provider.

```ts
type Intent =
  | 'reasoning' // Claude Opus / GPT-5
  | 'agentic' // Claude Sonnet / Copilot
  | 'fast' // Claude Haiku / GPT-4o-mini / Gemini Flash
  | 'embed' // text-embedding-3-small / Vertex
  | 'transcribe' // Whisper / Google STT
  | 'vision'; // GPT-4o / Gemini / Claude
```

### Credential storage

- `provider_credential.api_key_encrypted` — AES-256-GCM, per-workspace DEK wrapped by master KEK in GCP KMS.
- Decrypt only inside server-side request handlers; never crosses to client.
- Audit `agent_run.provider_used` + token usage + cost (computed from public price tables).

### Provider adapters

| Provider               | Adapter                           | Notes                                 |
| ---------------------- | --------------------------------- | ------------------------------------- |
| Anthropic              | `@ai-sdk/anthropic`               | Default for `reasoning` + `agentic`   |
| OpenAI                 | `@ai-sdk/openai`                  | Embeddings + fallback                 |
| Azure OpenAI           | `@ai-sdk/azure`                   | Enterprise / GDPR EU region           |
| Google Vertex / Gemini | `@ai-sdk/google`                  | Vision + cheap fast tier              |
| GitHub Copilot         | VS Code `lm` API (extension only) | Bridged via `mcp-server` for the rest |
| Ollama                 | `ollama-ai-provider`              | Local embeddings option               |

### Routing

1. Per-workspace **policy** (`provider_policy` jsonb): `{ reasoning: 'anthropic', fast: 'gemini', ... }`.
2. Per-call **override**: callers can pin.
3. **Fallback chain**: if primary errors → next; surfaced in UI.
4. **Cost cap**: monthly spend limit per workspace, enforced before each call.

---

## Capture pipeline (the most-used path)

```
mobile/web/browser/voice ──▶ POST /api/capture
                                │
                                ▼
                      INSERT capture (raw)
                                │
                                ▼
                  emit "capture.created" (Inngest)
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
            transcribe     classify         attach to
            (if audio)     (project,        timeline
                            urgency, kind)
                                │
                                ▼
                          chunk + embed
                                │
                                ▼
                  emit "memory.indexed"
                                │
                                ▼
              maybe trigger focus.recompute
```

Latency target: **capture button tap → "captured" toast in <300ms**. Heavy work (transcription, embedding) runs async; UI shows progressive states.

---

## Security model

- **Tenant isolation**: every query takes `workspaceId`; enforced at the data-access layer (`packages/db/queries`). Defense-in-depth: Postgres RLS policies on critical tables.
- **Auth**: Auth.js v5 with Google OAuth. Sessions in DB (Drizzle adapter). Mobile uses native browser flow → returns to deep link `metu://auth/callback` with PKCE.
- **BYOK encryption**: workspace DEK in DB (wrapped); KEK in GCP KMS; master key never leaves KMS.
- **Webhook auth**: HMAC verification (Stripe, GitHub, Telegram, Inngest signing key).
- **Rate limiting**: Upstash Ratelimit per IP + per user on capture/AI endpoints.
- **CSP / headers**: strict CSP, HSTS, X-Frame-Options, Referrer-Policy via `next.config.ts`.
- **Worker auth**: Cloud Run service is private; web → worker uses service-account ID token (audience-bound) + shared `WORKER_AUTH_TOKEN` for dev.
- **Audit log**: `timeline_event` doubles as audit trail for sensitive ops (BYOK changes, integration connect/disconnect, agent runs).

---

## Caching strategy (Next.js 16 Cache Components)

- Server Components default to dynamic; opt-in caching with `"use cache"`.
- Project list, focus state, memory queries → tagged caches, `updateTag()` after mutations for read-your-writes.
- Revalidation profiles in `next.config.ts`: `realtime` (60s SWR), `daily` (24h), `static` (∞).

---

## Deployment topology

| Component   | Platform                        | Why                                                       |
| ----------- | ------------------------------- | --------------------------------------------------------- |
| Web app     | Vercel                          | Next.js 16 first-class; edge functions for auth callbacks |
| Database    | Neon                            | Serverless Postgres + pgvector + branches per PR          |
| Worker      | GCP Cloud Run (europe-west1)    | Long-running tasks, GPU optional, GCS adjacency           |
| Storage     | GCS                             | Audio, screenshots, exports                               |
| Secrets     | GCP Secret Manager              | Single source of truth in prod                            |
| KMS         | GCP KMS                         | Envelope encryption for BYOK                              |
| Queue       | Inngest Cloud                   | Hosted; durable; great DX                                 |
| Cache/RL    | Upstash Redis                   | Vercel-region-aware                                       |
| Mobile      | Expo EAS                        | OTA updates, native builds                                |
| Browser ext | Chrome Web Store + Edge Add-ons | MV3                                                       |
| VS Code ext | VS Code Marketplace             | Direct + MCP                                              |
| MCP server  | Cloud Run + Vercel adapter      | Reachable from any MCP client                             |

DNS:

- `metu.ro` → Vercel (web)
- `app.metu.ro` → Vercel (auth-required app)
- `api.metu.ro` → Vercel API routes
- `worker.metu.ro` → Cloud Run via load balancer
- `mcp.metu.ro` → MCP server

---

## Observability

- Structured logs (pino) → Vercel logs + GCP Cloud Logging.
- Sentry for error tracking on web + mobile + worker.
- Inngest dashboard for workflow runs.
- Self-instrumented: every `agent_run` writes its own trace.
- OpenTelemetry traces from web → worker via W3C tracecontext.

---

## V1 → V4 roadmap

| Phase        | Includes                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1 (now)** | Auth, dashboard, brain dump, projects, memory engine, focus engine, GitHub + Google integrations, mobile capture, MCP server, VS Code ext basic, browser ext basic |
| **V2**       | Full agentic execution (multi-step tool use), Stripe + Vercel + Telegram integrations, energy tracking, calendar deep-integration, voice on web                    |
| **V3**       | Ambient intelligence — proactive suggestions, passive listening (opt-in), multi-device session continuity, wearable integration                                    |
| **V4**       | AI personality adaptation, public productization, team mode, marketplace of "second brain plugins"                                                                 |

---

## Anti-goals

- ❌ Generic chatbot UI as the front door.
- ❌ Generic kanban / todo manager.
- ❌ "100 integrations from day 1." Each integration must earn its place by closing a real loop.
- ❌ A fully autonomous agent before the supervised loop is rock-solid.
- ❌ Pretty dashboard with 50 widgets. Home stays brutally simple.

---

## Why these choices, briefly

- **Neon over Cloud SQL** for V1 → branch-per-PR + zero-ops + native Vercel adjacency. Terraform also provisions Cloud SQL as a documented migration target if data sovereignty demands it later.
- **Inngest over Temporal** → vastly better DX for serverless; Temporal earns its place only if we hit workflow complexity Inngest can't model.
- **Drizzle over Prisma** → SQL-first matches our heavy custom vector queries; smaller bundle; no codegen step on Vercel cold starts.
- **Auth.js v5** → no vendor lock-in, OSS, plays with Drizzle and works in RSC.
- **Vercel AI SDK** → uniform streaming + tools API across providers; matches BYOK mesh perfectly.
- **Expo over Tauri-mobile** → maturity, EAS Build, push, OTA. Tauri can come for desktop later.
