---
applyTo: 'apps/hub/**,apps/web/src/lib/hub.ts,apps/web/src/app/api/internal/**'
description: apps/hub WebSocket gateway + web↔hub bridge — envelopes, internal secret, presence.
---

# Hub realtime gateway

`apps/hub` is the only realtime path between the web app and devices/apps.
It runs on Cloud Run as a Hono + `ws` service on port `3001`.

## The two directions

- **Web → device** uses `hubBroadcast({ workspaceId, envelope, kinds?, deviceIds? })`
  from `apps/web/src/lib/hub.ts`. It POSTs to `${HUB_URL}/internal/broadcast`
  with header `x-hub-secret: ${HUB_INTERNAL_SECRET}`. **No-ops** when either
  env var is unset (so local dev without hub still works). Has a 5s
  AbortController timeout.
- **Device → web** is forwarded by the hub: WS frames (`tool.result`,
  `event.app|event.device`, `presence`, `pong`) get POSTed to
  `${WEB_INTERNAL_URL}/api/internal/hub/<endpoint>` with the same header.

## Envelope schemas

All envelopes live in `@metu/protocol`. Never hand-roll a JSON shape — import
the Zod schema and parse on receive. Server pushes use `ServerEventSchema`;
clients send `ClientEnvelopeSchema` (`hello`, `presence`, `event.*`, `pong`,
`tool.result`).

Common server envelopes:

| Kind                 | Sent when                                          |
| -------------------- | -------------------------------------------------- |
| `event.notification` | `notify()` fan-out                                 |
| `event.tool_request` | A tool is `awaiting_approval` (companion approves) |
| `command`            | `sendDeviceCommandAction` (ping/wake/capture/…)    |
| `pong`               | Reply to a client `ping`                           |

Filter pushes with `kinds: ['event.notification']` or
`deviceIds: [id1, id2]` — fan-out to all workspace devices is the default.

## Authentication

- **Client → hub WS**: a `Hello` envelope with a Bearer `metu_at_*` access
  token in the `auth` field. The hub recomputes `sha256(token)` and matches
  `oauthToken.tokenHash`. Required scopes vary by use; companion uses the
  `metu_app_companion` public client (PKCE).
- **Hub ↔ web internal**: `x-hub-secret` header compared via `safeEqual`
  (timing-safe) on BOTH sides — see `apps/hub/src/safe-equal.ts` and
  `apps/web/src/lib/safe-equal.ts`. Never `===`.

## Presence + devices

- On valid hello, the hub upserts a `device` row keyed by
  `(workspaceId, userId, fingerprint)` and marks `presence='online'`.
- Disconnect handler marks `presence='offline'`, sets `lastSeenAt = now()`,
  and emits `device/disconnected`.
- `presence` envelopes from the client update `device.presence` and
  `device.activity` (idle/active timestamps).

## DoS protection

`apps/hub/src/limits.ts` enforces:

- `HUB_MAX_CONNECTIONS` (default 10000) — close code `1013` when full.
- Per-IP handshake budget `HUB_HANDSHAKE_RATE` (default `30/min`, sliding
  window in memory) — close code `4008`.
- IP source: `x-forwarded-for` then `x-real-ip`. Only trustworthy behind
  the GCP load balancer; locally it's approximate.

When the service horizontally scales, the in-memory rate limit must move
to Redis (Upstash) — known follow-up.

## Web→hub helper

```ts
await hubBroadcast({
  workspaceId,
  envelope: ServerEventSchema.parse({ kind: 'event.notification', ...payload }),
  kinds: ['event.notification'],
  deviceIds: targets, // optional filter
});
```

It always parses the envelope before sending. If parsing fails, we throw —
**never** silently send malformed JSON to devices.

## What NOT to do

- ❌ Open your own WebSocket from the web app to a device. All realtime
  traffic goes through the hub.
- ❌ Add a new web endpoint that takes `x-hub-secret` outside `/api/internal/`
  — the proxy allowlist scopes the bypass to that prefix.
- ❌ Trust client envelopes without `parse()`-ing through the protocol schema.
- ❌ Compare `HUB_INTERNAL_SECRET` with `===`. Use `safeEqual`.
- ❌ Log access tokens or hello payloads verbatim.
