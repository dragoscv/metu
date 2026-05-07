---
applyTo: 'packages/core/src/agent/**,packages/core/src/goals/**,packages/ai/**,apps/web/src/inngest/**,apps/web/src/app/actions/**'
description: Conductor agent — tools registry, ACL policy, planner, AI SDK v5, BYOK provider mesh.
---

# Conductor & agent tools

The Conductor is metu's continuous supervisor agent. It plans, asks for
permission, calls tools, and emits notifications. **Every action it takes
goes through `runTool()`. Period.**

## Tool registry — `packages/core/src/agent/tools.ts`

A `ToolDefinition` has:

```ts
{
  name: string;             // unique, snake_case
  description: string;      // shown to the LLM AND in audit/UI
  kind: 'read' | 'low_risk' | 'high_risk';
  args: ZodTypeAny;         // zod v4 schema
  execute(args, ctx): Promise<{ result, undoPayload?: object | null }>;
  undo?(undoPayload, ctx): Promise<void>;  // required for auto-with-undo
}
```

When you add a tool:

1. Pick `kind` carefully — it's the default ACL. `read` is observe-by-default,
   `low_risk` is auto-with-undo, `high_risk` is ask-by-default.
2. Provide an `undo` if the tool can be reversed. Without it the
   `auto-with-undo` mode silently degrades to `ask`.
3. Register it in the `TOOLS` object (export keyed by `name`).
4. If the tool wraps an integration, accept `integrationId` in args so
   `extractIntegrationId(name, args)` in `policy.ts` can apply the
   per-integration ACL override.
5. Document it in the autonomy settings page (UI auto-derives from `TOOLS`,
   but `VIRTUAL_TOOLS` exists for route-only gates like `creds_borrow`).

## ACL policy — `packages/core/src/agent/policy.ts`

- Modes: `observe` (deny + log), `ask` (notify, await `conductor/approved`),
  `auto-with-undo` (run, store undoPayload), `autopilot` (run, no prompt).
- Resolution precedence (most specific wins):
  `tool_acl(scoped to integration)` → `tool_acl(workspace-wide)` →
  `agent_policy.defaultMode` → tool-`kind` default.
- Recursion: every `runTool()` call accepts a `depth` param. `MAX_TOOL_DEPTH`
  is `5`. Tools that re-enter MUST thread `depth + 1` through.
- Side effects of `runTool()`: writes a `tool_call` row + a `timeline_event`
  in one transaction; on `awaiting_approval` fires `conductor/notify` with
  Approve/Reject actions; on `failed` fires a normal-urgency notify.

## Planner — `packages/core/src/agent/planner.ts`

- Uses AI SDK v5 structured output (`generateObject`) with a Zod schema.
- Output is a small list of `(tool, args, why)` plans. Pulse rationale lives
  in the plan, not the tool args.
- Connected `external_mcp` integrations should be injected into the planner
  system prompt as "Connected external brains: …" so the model can call
  `external_invoke` intelligently. (Currently a known follow-up.)

## AI SDK v5 conventions

- Import from `'ai'` only. Define tools with `tool({ inputSchema, execute })`
  and Zod v4 `z.object` schemas — they work fine here despite the version mix.
- Use **`stepCountIs(n)`** from `'ai'` as the `stopWhen` condition. **Do not**
  pass a custom `(step) => boolean` callback — it's an SDK v4 pattern that
  silently breaks v5 multi-step.
- For chat streaming, return `result.toTextStreamResponse()`. The web UI uses
  plain `fetch` + `ReadableStream` reader (no `@ai-sdk/react`).
- `recall()` from `@metu/core/memory` returns a QueryResult-shaped value;
  always read it as `(result as { rows? }).rows ?? result`.

## Provider mesh — `packages/ai/src/registry.ts`

- BYOK: per-workspace `provider_credential` rows hold sealed API keys.
- Defaults: Opus 4.7 reasoning, Sonnet 4.5 agentic, Gemini Flash fast,
  text-embedding-3-small (1536-dim), Whisper, Sonnet vision.
- Workspace `unlimited` toggle disables the cost cap. Respect it in callers.
- Add a new provider? Update the registry, `provider_credential` rows, the
  Sealed crypto path, and the autonomy settings UI. Don't import the
  provider's SDK from app code — go through the registry.

## Inngest events — `apps/web/src/inngest/client.ts`

The full event map is the contract. When you add an event:

1. Extend `Events` in `client.ts`.
2. Register the handler in `apps/web/src/inngest/route.ts`.
3. Set `concurrency` (e.g. `{ limit: 50, key: 'event.data.workspaceId' }`)
   for fan-out events.
4. Use `step.run('descriptive-id', async () => ...)` for every external
   side effect — that's how Inngest gets durability + retries.
5. For long waits use `step.sleepUntil`/`step.waitForEvent`, not raw
   `setTimeout`.

Key existing flows to follow as templates:

- `conductor.tick` — supervisor loop (plan → pulse → run-through-ACL).
- `onConductorNotify` — fan-out to hub + web push + Expo (concurrency 50/ws).
- `nightlyProjectPulse` — cron `0 3 * * *`, lists active projects, then
  runs per-project momentum re-compute (concurrency 4).
- `goalsMorningCheckin` (`0 8 * * *`) + `goalsWeeklyReview` (`0 18 * * 0`).

## Audit + observability

- Mutating SDK routes (`/api/sdk/v1/{capture,events,intent,notify,…}`)
  MUST emit `conductor/observe` so the supervisor sees the change.
- `tool_call` rows are the audit trail; never bypass `runTool()` to write a
  side effect from inside a tool definition.
- Logging today is `console.*`. Pino + Sentry are documented but not
  installed yet — keep statements grep-friendly (`'[scope] message', { ... }`).

## What NOT to do

- ❌ Call a tool's `execute` directly. Always go through `runTool()`.
- ❌ Mark a destructive tool `low_risk` to skip the prompt.
- ❌ Forget `undoPayload` on a `low_risk` tool.
- ❌ Use a custom `stopWhen` callback on AI SDK v5 — use `stepCountIs(n)`.
- ❌ Inline a provider API key. BYOK or env, both via the registry.
