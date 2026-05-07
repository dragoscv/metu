---
applyTo: 'packages/sdk/**,packages/protocol/**,apps/web/src/app/api/sdk/**'
description: External SDK + protocol package — bearer-token endpoints, Zod schemas, scope checks.
---

# SDK + protocol contracts

`@metu/sdk` is the typed client used by external apps (notai, mmo) and the
companion. `@metu/protocol` is the shared Zod schema package — every event,
envelope, and request/response body that crosses a process boundary lives
there.

## Schema-first contract

When you change a cross-process payload:

1. Update the schema in `packages/protocol/src/`. Export the inferred type
   alongside (`export type X = z.infer<typeof XSchema>`).
2. Bump anything that consumes it: `@metu/sdk` client method, the
   `/api/sdk/v1/*` route, the hub envelope handler, the consuming app.
3. **Never** define a new ad-hoc shape in a route file. If the route
   accepts JSON, it parses through a `protocol` schema.

## SDK route template — `/api/sdk/v1/<thing>`

Every bearer route follows this structure:

```ts
import { resolveSession, hasScope, unauthorized, forbidden } from '@/lib/bearer';
import { inngest } from '@/inngest/client';
import { ThingSchema } from '@metu/protocol';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'thing:write')) return forbidden();

  const parsed = ThingSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });
  }

  // ... do the thing, scoped to session.workspaceId / session.userId

  // mutating routes MUST emit conductor/observe
  await inngest.send({
    name: 'conductor/observe',
    data: { workspaceId: session.workspaceId, eventKind: 'thing.created', payload: { ... } },
  });

  return Response.json({ ok: true });
}
```

## Existing endpoints (use as templates)

| Route                                 | Scope           | Purpose                              |
| ------------------------------------- | --------------- | ------------------------------------ |
| `POST /api/sdk/v1/capture`            | `capture:write` | Universal inbox ingest               |
| `POST /api/sdk/v1/recall`             | `recall:read`   | Hybrid semantic search               |
| `POST /api/sdk/v1/notify`             | `notify:write`  | Cross-app notification               |
| `POST /api/sdk/v1/events`             | `event:write`   | App-emitted events                   |
| `POST /api/sdk/v1/intent`             | `intent:write`  | Mirror an intent as a metu task      |
| `POST /api/sdk/v1/tools/decision`     | `tools:invoke`  | Approve/reject an awaiting tool call |
| `POST /api/sdk/v1/credentials/borrow` | `creds:borrow`  | Sealed-token borrow (gated by ACL)   |
| `POST /api/sdk/v1/push/register`      | `notify:read`   | Web-push / Expo token registration   |

All of them are allowlisted by `apps/web/src/proxy.ts` so cookie-auth is
skipped and bearer auth runs.

## Scopes

The canonical list is `KNOWN_SCOPES` in `packages/auth/src/oauth.ts` AND the
OIDC discovery document. Keep the two in sync. Add a new scope only with
explicit need; document it in `docs/integrations.md`.

## SDK client (`@metu/sdk`)

- Methods mirror routes 1:1. Always accept the typed input from
  `@metu/protocol`, never a loose object.
- Token storage: callers pass `accessToken`. Refresh is the caller's
  responsibility — the SDK does not auto-refresh (avoids hidden state for
  Tauri/companion).
- For OAuth flows use the SDK helpers: `buildAuthorizationUrl`,
  `createPkceChallenge`, `exchangeCode`, `refreshToken`,
  `requestDeviceCode`, `pollDeviceToken`. They handle PKCE + RFC 8628.

## What NOT to do

- ❌ Define an inline `z.object({...})` for a public payload — put it in
  `@metu/protocol`.
- ❌ Skip the `conductor/observe` emit on a mutating SDK route. The
  supervisor is blind without it.
- ❌ Add a route under `/api/sdk/v1/*` without updating the proxy allowlist
  (it's already pattern-matched, but don't drift).
- ❌ Return 500 with raw error messages. Use `{ error: 'invalid_grant' }` +
  appropriate status codes; OAuth errors via `oauthError()`.
