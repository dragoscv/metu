# Integrating a satellite app with metu

> "metu remembers, your other apps work." A satellite app (notai, mmo,
> bancai, vmui, brivio, …) is any product that:
>
> - signs the user in via metu OAuth2,
> - calls `@metu/sdk` to capture observations and read recall hits,
> - and optionally receives a live event feed via the hub WebSocket.

This recipe covers the minimum-viable wiring. After you finish it, the
metu Conductor sees your app's activity in its timeline and can act on
behalf of the user inside your app via tool calls.

## 1. Register the app

In the metu web app, go to `/settings/apps` and click **Register app**.
Fields:

| Field         | Notes                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Name          | Human-readable, e.g. `bancai-web`.                                                                 |
| Type          | `first_party` for your own apps, `third_party` for external.                                       |
| Redirect URIs | OAuth callbacks, e.g. `https://bancai.app/api/auth/callback/metu`.                                 |
| Scopes        | Space-separated. The default is sensible: `openid profile capture:write recall:read notify:write`. |
| Webhook URL   | Optional. POST target for `tool.invoke` envelopes when metu wants your app to do something.        |

The form returns a **client secret** (shown once) and, if you set a
webhook, a **webhook secret** (also shown once). Persist them in your
satellite app's secret store immediately.

## 2. Add `@metu/sdk` to the satellite

Inside a pnpm monorepo, alias the workspace:

```jsonc
// satellite/package.json
{
  "dependencies": {
    "@metu/sdk": "workspace:*",
  },
}
```

For a standalone repo, vendor the built `@metu/sdk` artefact via
`pnpm add @metu/sdk` after publishing, or copy the two files
(`src/index.ts`, `src/oauth.ts`) into your `lib/`. The SDK has zero deps
besides `@metu/protocol` and `zod`.

## 3. Wire a tiny adapter

Drop this in `lib/metu.ts` (or `src/lib/metu.ts`):

```ts
import { createClient } from '@metu/sdk';

const baseUrl = process.env.METU_BASE_URL ?? 'https://app.metu.ro';
const accessToken = process.env.METU_ACCESS_TOKEN;
if (!accessToken) {
  // Surface this loudly. Calls would 401 otherwise.
  throw new Error('METU_ACCESS_TOKEN missing — paste a workspace token from /settings/apps.');
}

export const metu = createClient({
  baseUrl,
  hubUrl: process.env.METU_HUB_URL ?? 'wss://hub.metu.ro',
  auth: { kind: 'token', accessToken },
});
```

## 4. Send one event so metu starts to "see" your app

Pick a write surface that already exists in your app and shadow it.
Example for an invoicing app:

```ts
// satellite/server/invoices.create.ts
import { metu } from '@/lib/metu';

export async function createInvoice(input: InvoiceInput) {
  const invoice = await db.insert(invoices).values(input).returning();

  // Fire-and-forget so metu observes — do NOT await on the critical path.
  void metu
    .event('invoice.created', {
      invoiceId: invoice.id,
      amount: invoice.amount,
      customerId: invoice.customerId,
    })
    .catch(() => {
      /* metu is best-effort; never block the user on its uptime */
    });

  return invoice;
}
```

Now `/timeline` in metu starts logging `invoice.created` rows, the
Conductor can recall them, and `/audit` shows your app as an active
source.

## 5. (Optional) Receive tool invocations

If you registered a webhook URL, metu will POST `tool.invoke` envelopes
when the user (or Conductor) decides to act on your app:

```http
POST https://bancai.app/api/metu/webhook
content-type: application/json
x-metu-signature: t=...,v1=...
{
  "type": "tool.invoke",
  "tool": "bancai.create_invoice",
  "args": { "customerId": "...", "amount": 120.0 },
  "callId": "tc_..."
}
```

Verify the signature with `hmac-sha256(secret, "t=...&body=...")` (use
the webhook secret from step 1). Acknowledge the call with `200 { ok: true }`
within 5 seconds; persist the work and call `metu.event('tool.result', ...)`
when it completes.

## 6. (Optional) Live channel

```ts
const ws = await metu.connect({
  kind: 'external_app',
  platform: 'node',
  name: 'bancai-server',
  fingerprint: 'bancai-server-1',
});

ws.on('event.notification', (n) => log.info({ n }, 'metu pushed a notification'));
```

The hub forwards `event.notification`, `tool.invoke`, `command`,
`persona.deactivate`, and `ping` envelopes — see
[`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts).

## 7. Verify

In metu:

1. `/timeline?source=<your-app-name>` should show the events.
2. `/audit` lists your app's tool calls + cost.
3. `/apps` shows the registered client; you can revoke or rotate the
   secret from there.

## Security checklist (don't skip)

- [ ] `METU_ACCESS_TOKEN` and webhook secret live in your secret store,
      not in source control.
- [ ] You verify the webhook HMAC before trusting the payload.
- [ ] You filter PII out of event payloads. metu logs are owner-readable.
- [ ] You handle 429 from metu by backing off; the SDK throws
      `MetuApiError { status: 429, code: 'rate_limited' }`.
- [ ] You never put user-supplied URLs into your event payloads without
      length capping (server-side SSRF guard exists in metu, but defense
      in depth is cheap).

## Reference implementations

- [notai](../../apps/notai) — first-party note app, full integration.
- [vscode-ext](../../apps/vscode-ext) — read-only consumer using the
  SDK for recall + brief.
- [browser-ext](../../apps/browser-ext) — capture + popup recall.

The same recipe scales to:

- **bancai** (`E:\gh\bancai`) — banking aggregator → `transaction.created`,
  `balance.updated`. Tools: `bancai.tag_transaction`, `bancai.export_csv`.
- **vmui** (`E:\gh\vmui`) — local VM controller → `vm.started`, `vm.stopped`.
  Tools: `vmui.snapshot`, `vmui.restart`.
- **brivio** (`E:\gh\brivio`) — document + invoicing SaaS →
  `document.uploaded`, `invoice.issued`. Tools: `brivio.send_to_anaf`,
  `brivio.create_payment_link`.
