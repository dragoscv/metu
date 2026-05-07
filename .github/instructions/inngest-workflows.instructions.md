---
applyTo: 'apps/web/src/inngest/**,apps/worker/src/**'
description: Inngest workflows + Cloud Run worker — events, step.run, concurrency, AI SDK v5.
---

# Inngest workflows & worker conventions

## Where things run

- **`apps/web/src/inngest`** — most functions live here. Mounted at
  `/api/inngest`. Triggered by events sent via `inngest.send({ name, data })`
  or by cron expressions.
- **`apps/worker`** — separate Cloud Run service for heavy / long-running
  jobs (transcription today; image processing next). Authenticated by
  `WORKER_AUTH_TOKEN` (timing-safe; ≥ 32 chars in prod or startup throws).

## Event registry — `apps/web/src/inngest/client.ts`

All event types live in the `Events` map. **This is the contract.** When
you add an event:

1. Extend `Events` with `'<scope>/<verb>': { data: { ... } }`.
2. Register the handler function in `apps/web/src/inngest/route.ts`.
3. Set concurrency where applicable.
4. If the event is fired from outside `apps/web` (e.g. SDK route, hub
   callback), import `inngest` and the type from `client.ts` to keep the
   payload type-safe.

Existing scopes: `capture/*`, `memory/*`, `focus/*`, `project/*`,
`integration/*`, `agent/*`, `conductor/*`, `device/*`, `goals/*`.

## Function patterns

### `step.run` is mandatory for side effects

```ts
export const onCaptureCreated = inngest.createFunction(
  { id: 'on-capture-created', concurrency: { limit: 50, key: 'event.data.workspaceId' } },
  { event: 'capture/created' },
  async ({ event, step }) => {
    const chunks = await step.run('chunk', () => chunkCapture(event.data.captureId));
    const vectors = await step.run('embed', () => embedAll(chunks));
    await step.run('persist', () => writeMemoryChunks(vectors));
    await step.sendEvent('notify-indexed', { name: 'memory/indexed', data: ... });
  },
);
```

Without `step.run`, a retry replays your code from the top — including
duplicate side effects. Always wrap.

### Concurrency

- Per-workspace fan-out: `{ limit: 50, key: 'event.data.workspaceId' }`.
- Cron-driven cross-workspace work: keep limits low (e.g. `4`) — see
  `nightlyProjectPulse`.

### Long waits

- `step.sleepUntil(date)` — calendar-aligned waits.
- `step.waitForEvent('conductor/approved', { timeout: '24h', match: '...' })`
  — pause until human approval (the conductor pattern).
- Never `setTimeout` / `setInterval` inside a function.

### Cron functions

- Use UTC cron strings. Example schedules in repo:
  - `nightlyProjectPulse` — `0 3 * * *`
  - `goalsMorningCheckin` — `0 8 * * *`
  - `goalsWeeklyReview` — `0 18 * * 0`
- Cross-workspace crons are privileged — they query ALL workspaces. Be
  very deliberate; lean on `step.run` per-workspace + concurrency caps.

## AI SDK v5 inside Inngest

- Import from `'ai'` only. Use `tool({ inputSchema })` with Zod v4 schemas.
- Use **`stepCountIs(n)`** as `stopWhen`. Never a custom callback.
- Stream responses with `result.toTextStreamResponse()` from chat routes;
  background functions usually want `result.text` (await the full text).
- Provider selection goes through `packages/ai/src/registry.ts` — never
  import `@ai-sdk/anthropic` etc. from app code.

## Worker conventions (`apps/worker`)

- Hono-style HTTP server. Each handler in `src/handlers/`.
- Auth header: `Authorization: Bearer ${WORKER_AUTH_TOKEN}`, compared with
  `crypto.timingSafeEqual`. Length-checked first.
- Jobs are dispatched from web Inngest functions via `step.fetch(WORKER_URL/...)`.
- Long jobs should stream progress via Inngest events — don't hold the
  HTTP connection open for minutes.

## Notifications (`onConductorNotify`)

Pattern reference for fan-out:

1. Triggered by `conductor/notify`.
2. `step.run('insert')` writes the `notification` row.
3. `step.run('hub')` fans out via `hubBroadcast({ kinds: ['event.notification'] })`.
4. `step.run('webpush')` sends VAPID web push to subscribed browsers.
   On `410`/`404` mark the subscription disabled.
5. `step.run('expo')` sends Expo push tickets.
6. Update `notification.deliveredTo`.

## What NOT to do

- ❌ Side effects outside `step.run` — retries will duplicate them.
- ❌ Missing concurrency on a fan-out event — DB connection pool dies.
- ❌ Custom `stopWhen` callback on AI SDK v5.
- ❌ Inline cron schedules in app code; they belong in the Inngest fn config.
- ❌ Catch-and-swallow inside a step — let Inngest see the failure to retry.
