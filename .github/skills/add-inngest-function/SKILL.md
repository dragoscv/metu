---
name: add-inngest-function
description: Add an Inngest workflow — event, handler, concurrency, cron. Use when the user asks for background jobs, scheduled tasks, fan-out processing, or human-in-the-loop pauses.
---

# Add an Inngest function

All durable / async work in metu runs through Inngest. The web app
(`apps/web/src/inngest`) hosts most functions; the worker (`apps/worker`)
hosts heavy ones (transcription).

## 1. Define / extend the event

`apps/web/src/inngest/client.ts` — add to the `Events` map:

```ts
export type Events = {
  // ...
  'thing/processed': {
    data: { workspaceId: string; thingId: string; reason?: string };
  };
};
```

Convention: `'<scope>/<verb>'`, present tense for triggers, past tense
for completions. `workspaceId` is virtually always in `data`.

## 2. Implement the function

In a sensibly named file under `apps/web/src/inngest/functions/`:

```ts
import { inngest } from '../client';

export const onThingProcessed = inngest.createFunction(
  {
    id: 'on-thing-processed',
    concurrency: { limit: 50, key: 'event.data.workspaceId' },
  },
  { event: 'thing/processed' },
  async ({ event, step, logger }) => {
    const { workspaceId, thingId } = event.data;

    const fetched = await step.run('fetch', async () => {
      // ALL side effects (DB, HTTP, AI calls) must live inside step.run
      return loadThing({ workspaceId, thingId });
    });

    const processed = await step.run('process', async () => {
      return processThing(fetched);
    });

    await step.sendEvent('notify-done', {
      name: 'conductor/notify',
      data: {
        workspaceId,
        userId: fetched.userId,
        title: 'Thing processed',
        urgency: 'normal',
        source: 'thing-processor',
      },
    });

    return { ok: true, processedId: processed.id };
  },
);
```

Patterns:

- **`step.run` is mandatory** for every external side effect. Without it,
  retries will replay the code from the top and duplicate work.
- **Concurrency**: per-workspace fan-out → `{ limit: 50, key: 'event.data.workspaceId' }`.
  Cross-workspace cron → small fixed limit (e.g. `4`).
- **Long pauses**: `step.sleepUntil(date)` or
  `step.waitForEvent('conductor/approved', { timeout: '24h', match: '...' })`.
- **Failures**: throw — Inngest retries with backoff. Catch only when you
  want to swallow + emit a `notify` instead.
- **Cron**: pass `{ cron: '0 3 * * *' }` instead of `{ event: ... }`. UTC.

## 3. Register in the Inngest router

`apps/web/src/inngest/route.ts`:

```ts
import { onThingProcessed } from './functions/on-thing-processed';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // ...
    onThingProcessed,
  ],
});
```

## 4. Trigger the event

From a Server Action or SDK route:

```ts
await inngest.send({
  name: 'thing/processed',
  data: { workspaceId, thingId },
});
```

## 5. Test locally

The Inngest dev server is part of `pnpm dev`. Open
<http://localhost:8288> to see runs, retries, and step output.

- Trigger from the UI / SDK and watch it execute.
- Fail it intentionally (throw inside a `step.run`) — confirm retries.
- For `waitForEvent`-based functions, fire the matching event and confirm
  resume.

## 6. Worker-bound jobs (heavy / GPU)

If the work is CPU/GPU heavy or > a few seconds:

- Define the function in `apps/worker/src/handlers/<name>.ts`.
- Hit it from a web Inngest function via `step.fetch(WORKER_URL/...)` with
  the `WORKER_AUTH_TOKEN` bearer header.
- Worker is auth'd via timing-safe compare; in prod the token must be ≥ 32
  chars or startup throws.

## What NOT to do

- ❌ Side effects outside `step.run`.
- ❌ Forget concurrency on a fan-out event — DB connection pool will die.
- ❌ Use `setTimeout` / `setInterval`.
- ❌ Pass `stopWhen: (step) => …` to AI SDK v5 calls — use `stepCountIs(n)`
  from `'ai'`.
- ❌ Throw raw `error.message` to the user. Catch + emit `conductor/notify`
  with a friendly message.
