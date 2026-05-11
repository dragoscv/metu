# Satellite integration patches

Drop-in patches you apply by hand to a sibling repo to wire it up with
metu's OAuth + SDK. Each file in this folder is a per-repo recipe with:

1. New files to create (full contents).
2. Lines to add to `package.json` / `.env.example`.
3. A "first call" snippet that proves the wiring works.

Apply order is the same for every repo:

```pwsh
# 1. From the satellite repo (e.g. E:\gh\bancai):
pnpm add zod
# 2. Register the app in metu at http://localhost:24890/settings/apps.
#    Grab CLIENT_ID, CLIENT_SECRET, and (if you opt in) WEBHOOK_SECRET.
# 3. Paste these into the satellite's `.env.local`:
#    METU_BASE_URL=http://localhost:24890
#    METU_HUB_URL=ws://localhost:24891
#    METU_CLIENT_ID=...
#    METU_CLIENT_SECRET=...
#    METU_ACCESS_TOKEN=...   # short-lived; rotate via OAuth in production
#    METU_WEBHOOK_SECRET=... # only if you registered a webhook URL
# 4. Drop the files from the relevant patch file into the satellite repo.
# 5. Run the smoke command at the bottom of each patch.
```

All patches share these guarantees:

- **Zero metu workspace deps.** They use plain `fetch` + zod + a hand-rolled
  HMAC verifier. Drop them into any node/edge runtime.
- **Fail loud.** Missing `METU_ACCESS_TOKEN` throws at import time, not at
  call time. Webhook signature mismatch returns 401.
- **Best-effort capture.** `metu.event()` calls are wrapped in
  `void ... .catch()` so satellite uptime is never tied to metu's.

Patches:

- [bancai.md](./bancai.md) — banking aggregator (Next.js + Drizzle).
- [vmui.md](./vmui.md) — local VM controller (Next.js + child_process).
- [brivio.md](./brivio.md) — document/invoicing SaaS (Next.js + Drizzle + Stripe).

If you're building a brand-new satellite, prefer the
[`@metu/sdk` workspace import path](../satellite-app.md) over these
hand-rolled adapters — patches exist only because these three repos live
outside the metu pnpm workspace.
