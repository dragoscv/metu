---
name: add-integration
description: Wire a new third-party integration (GitHub, Google, Slack, Telegram, custom MCP, etc.) — sealed tokens, OAuth, sync function, agent tool. Use when the user wants metu to observe or act on an external service.
---

# Add an integration

Integrations are watchable + actionable third-party connections (GitHub,
Gmail, Calendar, Telegram, Stripe, custom MCP, …) per workspace. Their
tokens are AES-256-GCM-sealed; their actions go through agent tools.

## 1. Pick the integration kind

Open `packages/db/src/schema/integrations.ts`, find the `integration_kind`
pgEnum. Add the new value:

```ts
export const integrationKind = pgEnum('integration_kind', [
  'github_repo',
  'gmail',
  'gcal',
  'telegram_chat',
  'stripe_account',
  'external_mcp',
  'my_thing', // ← new
]);
```

Mirror it in `@metu/types` (`integrationKindSchema`) and in
`packages/db/src/queries/integrations.ts` (`IntegrationKindRow`). All three
must agree.

Generate a migration (see [add-db-migration](../add-db-migration/SKILL.md)).
For enum additions:

```sql
ALTER TYPE "integration_kind" ADD VALUE IF NOT EXISTS 'my_thing';
```

## 2. Auth flow

Three common patterns:

| Pattern        | Use when                                               |
| -------------- | ------------------------------------------------------ |
| OAuth 2 / OIDC | Service has a standard OAuth provider (Google, GitHub) |
| Personal token | User pastes a long-lived API key (Telegram, Stripe)    |
| Custom MCP     | URL + bearer token, validated via SSRF guard           |

Implementation:

- For OAuth flows, add the redirect endpoint under
  `apps/web/src/app/api/integrations/<kind>/callback/route.ts`, exchange
  the code, seal the token, write the `integration` row.
- For pasted tokens, add a Server Action `connect<Kind>Action` that takes
  `{ workspaceId, token, ...config }`, validates with Zod, **calls
  `assertSafeOutboundUrl(url)` if a URL is involved**, seals the token,
  upserts the integration.

Persist tokens via `@metu/ai/crypto`:

```ts
import { sealValue } from '@metu/ai/crypto';

const sealed = sealValue(rawToken); // { ciphertext, iv, tag }
await db.insert(integration).values({
  workspaceId,
  kind: 'my_thing',
  externalId: <stable-id-from-service>,
  status: 'active',
  config: { sealed },
});
```

## 3. Sync function

Most integrations need a periodic / event-driven sync into our DB.

Follow [add-inngest-function](../add-inngest-function/SKILL.md):

- Event: `integration/sync` (already exists). Filter handler by
  `event.data.integrationId`.
- Or: a kind-specific event (`my_thing/event-received`) for webhooks.
- Wrap every external call in `step.run`. Open the sealed token lazily
  inside that step:

```ts
const token = await step.run('open-token', async () => {
  const row = await getIntegration(integrationId);
  return openSealed(row.config.sealed);
});
```

- Persist results as captures, timeline events, tasks, decisions, or
  domain rows — whatever makes sense for "what did the user do?"

## 4. Agent tool (if the integration is actionable)

Follow [add-agent-tool](../add-agent-tool/SKILL.md). The tool should:

- Accept `integrationId` in args so per-integration ACL works
  (`extractIntegrationId` reads it).
- Open the sealed token inside `execute`.
- Choose `kind: 'high_risk'` if the action is destructive / external (most
  are — sending a Telegram message, opening a PR, …).

Example: for `external_mcp` we have `external_invoke` that proxies to a
remote MCP server. Keep yours just as narrow.

## 5. UI surface

Add a card to `/integrations`:

- For built-ins, add to the static grid in `integrations-grid.tsx`.
- For dynamic configs (URL + token, like external MCP), follow the
  pattern in `external-mcp-section.tsx`: form → connect action → status
  card with refresh / remove.

After connect / refresh / remove, the action calls
`revalidatePath('/integrations')`.

## 6. Webhook (if applicable)

For services that push events:

- Add `apps/web/src/app/api/webhooks/<kind>/route.ts`.
- Verify signature with **`safeEqual`** (timing-safe).
- Translate the payload into a domain event (`capture/created`,
  `integration/sync`, …) and `inngest.send` it.
- Add the route to `proxy.ts` allowlist (or under `/api/webhooks/*` if
  already pattern-matched).

## 7. Document & verify

- `pnpm db:push` to apply enum addition.
- Connect the integration locally; verify a `tool_call` and / or
  `timeline_event` appears.
- Update `docs/integrations.md`.
- Append a slice / gotcha entry to
  `/memories/repo/metu-master-decisions.md`.

## Checklist

- [ ] `integration_kind` enum updated in schema, types, queries.
- [ ] Migration generated, made idempotent, applied.
- [ ] Tokens sealed via `@metu/ai/crypto`. Never plaintext.
- [ ] User-supplied URLs guarded by `assertSafeOutboundUrl`.
- [ ] Webhook secrets verified with `safeEqual`.
- [ ] Sync function: every external call inside `step.run`.
- [ ] Action tools (if any): right `kind`, `integrationId` in args.
- [ ] UI card on `/integrations`.
- [ ] Workspace scoping on every query.
