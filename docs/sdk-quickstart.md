# `@metu/sdk` quickstart

> The TypeScript SDK every external app uses to talk to metu.

## Install

```bash
pnpm add @metu/sdk
```

The package is currently consumed via the workspace inside the metu monorepo.
For published apps (notai, mmo, …) it will ship to npm as `@metu/sdk`.

## Register an OAuth client

1. Sign in to [app.metu.ro](https://app.metu.ro).
2. Visit **API apps** in the sidebar (`/apps`).
3. Click **Register app**, pick a name, type, and the scopes you need.
4. Copy the `client_id` and `client_secret` from the one-time secret card.
   The secret is shown **once** — store it in your app's secrets manager.

## Authenticate

Three auth modes are supported:

| Mode                | When to use                                                  |
| ------------------- | ------------------------------------------------------------ |
| `token`             | You already have an access token (server-to-server, mobile). |
| `oauth_device_flow` | Headless / TV / CLI client — user pastes a 6-digit code.     |
| `api_key`           | Long-lived service key for trusted backends (rare).          |

## Minimal example

```ts
import { createClient } from '@metu/sdk';

const metu = createClient({
  baseUrl: 'https://app.metu.ro',
  hubUrl: 'wss://hub.metu.ro',
  auth: { kind: 'token', accessToken: process.env.METU_ACCESS_TOKEN! },
});

// Capture an event
await metu.capture({
  kind: 'text',
  content: 'user opened the pricing page',
  source: { app: 'notai', surface: 'web' },
});

// Notify across all the user's devices
await metu.notify({
  title: 'Quote ready for review',
  urgency: 'normal',
  actionUrl: 'https://notai.app/quotes/abc',
});

// Recall context
const hits = await metu.recall({ query: 'pricing decision Q3' });

// Borrow a credential (ACL-gated, audited)
const cred = await metu.borrow({
  integrationId: 'gh_main',
  purpose: 'open PR for triage',
  ttlSec: 300,
});

// Live channel
const ws = await metu.connect({
  kind: 'external_app',
  platform: 'node',
  name: 'notai-server',
  fingerprint: 'notai-server-1',
});
ws.on('event.notification', (n) => console.log('[metu]', n.title));
```

## Scopes

Each call requires a specific scope on the OAuth client:

| Method           | Scope                                          |
| ---------------- | ---------------------------------------------- |
| `capture()`      | `capture:write`                                |
| `recall()`       | `recall:read`                                  |
| `notify()`       | `notify:write`                                 |
| `intent()`       | `intent:write`                                 |
| `borrow()`       | `credential:borrow`                            |
| `auditSummary()` | `audit:read`                                   |
| `timeline()`     | `event:read`                                   |
| `connect()` (WS) | `event:read` (subscribe) + the per-event scope |

Requesting a scope your client wasn't granted returns `403 forbidden`.

## What metu records

Every state-changing call writes:

- A `tool_call` row (audit + cost accounting).
- A `timeline_event` row (visible to the user under `/timeline`).
- A `conductor/observe` Inngest event (so the Conductor can react).

Read-only calls (`recall`, `auditSummary`, `timeline`) record only when
they cross the per-workspace ratelimit budget.

## Errors

All non-2xx responses throw a `MetuApiError` with `status`, `code`, `message`,
and an optional `detail` payload. Common codes:

- `forbidden_scope` — token is missing the required scope.
- `rate_limited` — endpoint hit the per-token budget; back off per the
  `retry-after` header.
- `invalid_input` — Zod validation failed; `detail` carries the issues.

## Right to export

End users can pull a JSON archive of their workspace at
`GET /api/workspace/export` (cookie auth, owner role only). The archive
includes captures, decisions, briefings, projects, goals, timeline events,
and tool calls.

## See also

- [`docs/architecture.md`](./architecture.md) — how the hub, web, and
  worker fit together.
- [`docs/integrations.md`](./integrations.md) — OAuth flows and the
  difference between Apps and Integrations.
- [`docs/security.md`](./security.md) — sealed secrets, scope evaluation,
  rate limits.
