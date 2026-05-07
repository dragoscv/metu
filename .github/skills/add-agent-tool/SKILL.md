---
name: add-agent-tool
description: Register a new tool the Conductor (or any agent) can call — schema, kind, undo, ACL hookup. Use when the user wants the agent to perform a new action ("let it create tasks", "add a tool that posts to telegram", etc.).
---

# Add an agent tool

Every action the Conductor takes is a `ToolDefinition` in
`packages/core/src/agent/tools.ts`. **Never** call `execute` directly — go
through `runTool()` so ACL, audit, and undo are honored.

## Steps

### 1. Choose the `kind`

| `kind`      | Default ACL behavior                                          |
| ----------- | ------------------------------------------------------------- |
| `read`      | Always allowed (unless workspace mode is `observe`).          |
| `low_risk`  | `auto-with-undo` by default — needs an `undo` implementation. |
| `high_risk` | `ask` by default — Conductor will pause for human approval.   |

Destructive operations (delete, send external message, transfer money,
borrow credentials) are **always** `high_risk`. When in doubt, escalate.

### 2. Write the Zod schema

Schema goes in the same file as the tool. Use Zod v4. Keep arg names
consistent with existing tools (`workspaceId` is implicit from `ctx`,
not in args). Include `integrationId` if the tool wraps an integration —
`extractIntegrationId(name, args)` in `policy.ts` uses that for
per-integration ACL overrides.

```ts
const myToolArgs = z.object({
  integrationId: z.string().uuid().optional(),
  payload: z.string().min(1),
});
```

### 3. Implement `execute` (and `undo` if applicable)

```ts
const myTool: ToolDefinition<typeof myToolArgs> = {
  name: 'my_tool',
  description: 'Short, factual description shown to the LLM.',
  kind: 'low_risk',
  args: myToolArgs,
  async execute(args, ctx) {
    const result = await doTheThing({ ...args, workspaceId: ctx.workspaceId });
    return { result, undoPayload: { id: result.id } };
  },
  async undo(undoPayload, ctx) {
    await reverseTheThing({ id: undoPayload.id as string, workspaceId: ctx.workspaceId });
  },
};
```

Notes:

- `undoPayload` is jsonb-stored on the `tool_call` row. Keep it small.
- `execute` runs inside `runTool()` which already wraps a transaction +
  audit row. Your function adds DB work to that transaction implicitly via
  `getDb()` (Drizzle uses an AsyncLocalStorage). Don't open a second client.
- If `kind: 'low_risk'` and you can't write `undo`, escalate to `high_risk`.

### 4. Register it

In `tools.ts`, add to the `TOOLS` object:

```ts
export const TOOLS = {
  recall: recallTool,
  // ...
  my_tool: myTool,
} as const;
```

Type inference picks it up automatically; the planner will see it.

### 5. Default ACL row (optional)

If the workspace default needs to differ from the `kind` default, write a
`tool_acl` row in `apps/web/src/app/actions/autonomy.ts`'s seed flow, or
let the user configure it via `/settings/autonomy`.

### 6. UI surface

The autonomy settings page reads `TOOLS` automatically and renders one row
per tool. For route-only gates (no ToolDefinition — e.g. `creds_borrow`),
add a stub to `VIRTUAL_TOOLS` so the UI shows it.

### 7. Test it manually

1. From `/conductor`, ask the agent to use the tool.
2. Verify a `tool_call` row appears with the right `status`.
3. For `ask` mode: confirm the notification appears in the bell with
   Approve/Reject. Click Approve → tool runs. Click Reject → it's marked
   rejected.
4. For `low_risk`: verify undo works via the `undoToolCallAction`.

### 8. Document the gotchas

Append to `/memories/repo/metu-master-decisions.md` if there's anything
non-obvious: weird API quirks, why you chose `high_risk`, a transient
state another tool depends on.

## Checklist

- [ ] `kind` chosen deliberately; destructive = `high_risk`.
- [ ] Zod schema named `<tool>Args`; includes `integrationId` if applicable.
- [ ] `execute` returns `{ result, undoPayload? }`.
- [ ] `undo` implemented for `low_risk` (or escalated to `high_risk`).
- [ ] Registered in the `TOOLS` object.
- [ ] Workspace scoping enforced via `ctx.workspaceId`.
- [ ] Manually verified through the conductor in all configured modes.
