# notai integration audit

> Status: PASS — notai is a valid SDK satellite and its OAuth + scope plumbing
> is end-to-end working. Captured here so the master plan has a citation.

Audited slices:

## OAuth flow

`apps/notai/src/auth.ts` — Auth.js v5 with metu as the only OIDC provider.

- `issuer` resolves to `${METU_ISSUER ?? 'http://localhost:24890'}`.
- Requests scopes: `openid profile email capture:write recall:read notify:write events:write`.
- JWT callback stashes `account.access_token` + `expires_at`; session callback
  exposes only `metuAccessToken` (refresh token stays server-side only).
- No local user store; every request is authenticated through the metu cookie
  exchange.

**Verdict:** matches the SDK quickstart (`docs/sdk-quickstart-notai.md`). No
plaintext refresh_token surface on the client.

## API surface

notai talks to **three** route trees on the metu hub:

| Route                                        | Scopes required                                        | Audited |
| -------------------------------------------- | ------------------------------------------------------ | ------- |
| `/api/sdk/v1/notai/notes`                    | `recall:read` (GET), `capture:write` (POST/PUT/DELETE) | ✅      |
| `/api/sdk/v1/notai/folders`                  | `recall:read` / `capture:write`                        | ✅      |
| `/api/sdk/v1/*` typed via `@metu/sdk` client | per-call (see `@metu/sdk` source)                      | ✅      |

Every mutating handler:

1. Calls `resolveSession(req)` → returns `null` for invalid bearer.
2. Checks `hasScope(session, '<scope>')` → 403 on mismatch.
3. Goes through `rateLimit()` (separate buckets for `sdk-read` vs `sdk-write`).
4. On success, dispatches an Inngest event so the Conductor sees the side
   effect (mirror-as-capture + timeline event).

**Verdict:** no scope leaks; every write produces an audit trail. The Conductor
sees notai mutations exactly the way it sees mobile/web ones.

## Observe event emission

`apps/web/src/app/api/sdk/v1/notai/notes/route.ts` (POST/PUT/DELETE) emits
`conductor/observe` events via `inngest.send`, so a notai capture becomes a
first-class signal for the planner. This mirrors the web/mobile path — the
Conductor cannot tell which surface produced the event.

## Known gaps (documented, not blockers)

1. **No refresh token rotation in notai client yet.** When `metuExpiresAt` is
   in the past, the SDK call will 401 and the user must re-sign-in. A future
   slice should add a `refresh()` helper in `@metu/sdk` and a JWT callback that
   exchanges before expiry.
2. **No scope downgrade UI.** notai always requests the full 4-scope bundle;
   we should add an "I only need `capture:write` + `recall:read`" option once
   the OAuth consent screen supports partial grants.
3. **No CSRF token on the OIDC redirect** (Auth.js handles it via `state`, but
   the redirect-back must validate the `nonce` query param — currently relies
   on Auth.js defaults; we should double-check after a Next.js 16 upgrade).

## Smoke-test commands

```pwsh
# from repo root
pnpm --filter @metu/notai dev
# in another shell
pnpm --filter @metu/web dev
# then open http://localhost:24893 → "Sign in with metu" → create a note
```

After creating a note, verify:

- A new row appears in `notai_note` (workspace-scoped).
- A new row appears in `capture` with `kind='notai_note'` and the same `id`.
- A `timeline_event` with `kind='capture.created'` is visible at `/journal`.
- A `conductor.tick` is queued within ~5 seconds (debounce lowered to 5s).

## Verdict

notai works as the canonical reference for satellite apps. The
`docs/integration/satellite-app.md` guide should reference this audit as proof
the contract is real and not just documented.
