# notai

Reference implementation of a third-party app that consumes [`metu`](../web)
via the `@metu/sdk`.

What it demonstrates:

- **OIDC sign-in** against metu (`/oauth/authorize` → `/oauth/token`) via
  Auth.js v5 with metu as the only provider.
- **Capture** notes into metu memory.
- **Recall** recent captures from metu memory.
- **Notify** the user on whichever device they're most present on.

## Run locally

```sh
# 1. Register a client in metu's dev DB (or via the /apps page).
#    Use redirect URI: http://localhost:24896/api/auth/callback/metu
# 2. Copy env, fill credentials.
cp apps/notai/.env.example apps/notai/.env.local
# 3. Start metu first (port 24890), then notai (port 24896).
pnpm --filter @metu/notai dev
```

Open <http://localhost:24896>, click "Sign in with metu", capture a note,
verify it shows up in metu's `/memory` page.

## Status

- Slice 7 scaffold (single page proves the loop). Notes CRUD + sidebar
  - sync are the next slice.
