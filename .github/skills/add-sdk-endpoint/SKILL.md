---
name: add-sdk-endpoint
description: Add a bearer-protected SDK endpoint under /api/sdk/v1/ — scope, schema, observe event. Use when an external app (notai, mmo, companion, mobile) needs a new server capability.
---

# Add an SDK endpoint

`/api/sdk/v1/*` routes are the public, bearer-token-protected surface for
external apps and the companion. They are NOT for cookie-authenticated web
users — those use Server Actions.

## 1. Add the schema

`packages/protocol/src/<feature>.ts`. Export both the schema and the inferred type:

```ts
import { z } from 'zod';

export const ThingCreateSchema = z.object({
  title: z.string().min(1).max(500),
  metadata: z.record(z.unknown()).optional(),
});
export type ThingCreate = z.infer<typeof ThingCreateSchema>;
```

Re-export from `packages/protocol/src/index.ts`.

## 2. Pick (or add) the scope

Open `packages/auth/src/oauth.ts`, find `KNOWN_SCOPES`. Reuse if there's a
fit (`event:write`, `capture:write`, etc.). Otherwise add a new scope and
also add it to the OIDC discovery doc
(`apps/web/src/app/.well-known/openid-configuration/route.ts`).

Keep scopes coarse-grained — one per capability domain, not per endpoint.

## 3. Implement the route

`apps/web/src/app/api/sdk/v1/<feature>/route.ts`:

```ts
import { resolveSession, hasScope, unauthorized, forbidden } from '@/lib/bearer';
import { inngest } from '@/inngest/client';
import { ThingCreateSchema } from '@metu/protocol';
import { getDb } from '@metu/db';
import { thing } from '@metu/db/schema';

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'thing:write')) return forbidden();

  const parsed = ThingCreateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const [row] = await db
    .insert(thing)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      ...parsed.data,
    })
    .returning(); // 0.36: NEVER pass a projection

  // Mutating routes MUST emit conductor/observe.
  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'thing.created',
      payload: { thingId: row.id, source: session.clientId ?? 'sdk' },
    },
  });

  return Response.json({ ok: true, id: row.id });
}
```

Key invariants:

- `proxy.ts` already allowlists `/api/sdk/v1/*` — no extra config needed.
- Workspace scoping is via `session.workspaceId` (resolved from the
  bearer token).
- For SSRF risk (user-supplied URL in body) call `assertSafeOutboundUrl`
  before fetching it.

## 4. Add a method to `@metu/sdk`

`packages/sdk/src/client.ts` (or wherever your method group lives):

```ts
async createThing(input: ThingCreate): Promise<{ ok: boolean; id: string }> {
  return this.fetch('/api/sdk/v1/thing', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
```

## 5. Rate limit (if needed)

Auth-touching, expensive, or write-heavy endpoints get a limiter via
`apps/web/src/lib/ratelimit.ts`. Wrap the handler:

```ts
const { success } = await ratelimit.thingWrite.limit(`${session.workspaceId}:${session.clientId}`);
if (!success) return Response.json({ error: 'rate_limited' }, { status: 429 });
```

## 6. Manual test

```pwsh
$token = '<dev-token-or-metu_at_*>'
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sdk/v1/thing `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType 'application/json' `
  -Body '{"title":"hello"}'
```

Verify:

- 200 response with the new id.
- Row written with the right `workspace_id`.
- `conductor/observe` event visible in the Inngest dev server.
- Wrong scope returns 403.
- Missing token returns 401.

## Checklist

- [ ] Zod schema in `@metu/protocol`.
- [ ] Scope added to `KNOWN_SCOPES` and OIDC discovery (if new).
- [ ] `resolveSession` + `hasScope` checks at the top.
- [ ] Body validated through Zod (no inline shapes).
- [ ] Workspace scoping via `session.workspaceId`.
- [ ] `conductor/observe` emitted for mutations.
- [ ] SDK client method added.
- [ ] Rate limiter applied if hot.
- [ ] Manually tested 200 / 400 / 401 / 403.
