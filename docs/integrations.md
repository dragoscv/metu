# metu — Integrations

metu is **read-mostly** with the outside world: integrations stream events in,
and metu turns them into memory + timeline. Outbound is reserved for explicit
user actions (e.g. logging a decision back to GitHub).

## Mental model: Integrations vs API apps

These are _inverses_ and live in two different surfaces. Don't confuse them.

| Surface                        | Direction                             | Table                            | Example                                                                                    |
| ------------------------------ | ------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------ |
| `/integrations`                | metu → external service               | `integration`                    | metu calls GitHub with the user's token                                                    |
| `/integrations` (Custom OAuth) | metu → external service via BYO OAuth | `oauth_app` + `oauth_connection` | user wires an arbitrary OIDC provider with their own client_id/secret                      |
| `/apps` (**API apps**)         | external app → metu                   | `oauth_client`                   | mobile, browser-ext, MCP clients, future SaaS surfaces authenticate as a metu OAuth client |

When in doubt: if the credential lets _metu_ read someone else's data, it's an
**integration**. If the credential lets _another app_ act as a metu user,
it's an **API app**.

## Multi-account

Every integration is scoped by `(workspace_id, kind, external_id)`, so you can
connect any number of accounts of the same kind — e.g. a personal GitHub plus
two org GitHubs, or a `live` and a `test` Stripe.

When more than one is connected, exactly one row per `(workspace, kind)` is
flagged `is_default`. Pick what "the" GitHub means with the **Make default**
action on each card. Server consumers should call `getDefaultIntegration` when
they need to choose one, or `listIntegrationsByKind` when they want to fan
out across all accounts.

A partial unique index enforces the single-default invariant in Postgres:

```sql
CREATE UNIQUE INDEX integration_default_unique_idx
  ON integration (workspace_id, kind) WHERE is_default;
```

## Google (Gmail + Calendar)

Sign-in already requests scopes:

```
openid email profile
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
```

Tokens are persisted in the Auth.js `account` table and refreshed on demand.
Scheduled Inngest functions hydrate `timelineEvent` rows from recent threads
and upcoming meetings. We **never** post to Gmail/Calendar in V1.

To revoke: <https://myaccount.google.com/permissions> → metu → Remove.

## GitHub

A **GitHub App** (not OAuth) is the recommended path:

1. Create the app at <https://github.com/settings/apps/new>:
   - Webhook URL: `https://app.metu.ro/api/webhooks/github`
   - Webhook secret: `<value of GITHUB_WEBHOOK_SECRET>`
   - Permissions: `contents:read`, `metadata:read`, `pull_requests:read`, `issues:read`
   - Events: `push`, `pull_request`, `issues`, `issue_comment`, `release`
2. Install the app on the repos you want metu to watch.
3. metu's webhook receiver verifies the HMAC signature (`x-hub-signature-256`)
   and emits an Inngest event per relevant action.

Each commit/PR/issue becomes a `timelineEvent` and contributes to project
**momentum**.

## Telegram

A bot lets you brain-dump from your phone without opening the app.

```pwsh
# 1. Talk to @BotFather, get a token
# 2. Set the webhook (the URL contains the token to authenticate Telegram itself)
$tok = "<your-bot-token>"
$slug = ($tok -replace '[^a-zA-Z0-9]','')
curl -X POST "https://api.telegram.org/bot$tok/setWebhook" `
  -d "url=https://app.metu.ro/api/webhooks/telegram/$slug"
```

Send a message, voice note, or photo to the bot — metu treats it as a capture
on your personal workspace. Voice messages go through the Cloud Run worker for
transcription before embedding.

## Stripe

For metu's own subscription billing **and** for ingesting your customer
revenue events as project signals.

- Webhook URL: `https://app.metu.ro/api/webhooks/stripe`
- Events to subscribe to (minimum): `checkout.session.completed`,
  `invoice.payment_succeeded`, `customer.subscription.*`, `charge.refunded`.
- Signing secret → Vercel env `STRIPE_WEBHOOK_SECRET`.

## Vercel

Vercel deployments are pulled via REST polling (read-only token):

- Create a personal access token at <https://vercel.com/account/tokens>.
- Set `VERCEL_TOKEN` and `VERCEL_TEAM_ID` in Vercel envs.
- A scheduled Inngest function pulls `listDeployments` per project and writes
  `timelineEvent` rows tagged `deploy.success` / `deploy.error`.

## Custom: OpenAI-compatible endpoints

Any OpenAI-compatible endpoint (vLLM, Together, Groq, OpenRouter, your own
gateway) works via `provider: 'custom'` in BYOK — set the `endpoint` field
when adding the credential.

## Adding a new integration

1. Implement a typed client in `packages/integrations/src/<service>/`.
2. Define webhook verifier (if applicable) — never trust the request body otherwise.
3. Add a Zod-validated server action or webhook route in `apps/web`.
4. Emit Inngest events for downstream processing — keep webhooks under 100 ms.
5. Add the connect card to `/integrations` and document here.
