# @metu/sdk

Typed client for [METU](https://metu.ro) — the Personal AI Operating
System. Covers capture, recall, notify, devices, conversations, and the
realtime WebSocket hub.

## Install

```sh
pnpm add @metu/sdk
```

## Quickstart

```ts
import { createClient } from '@metu/sdk';

const metu = createClient({
  baseUrl: 'https://app.metu.ro',
  hubUrl: 'wss://hub.metu.ro',
  auth: { kind: 'token', accessToken: process.env.METU_TOKEN! },
});

// Capture a thought into memory
await metu.capture({ kind: 'text', content: 'idea: ship the conductor' });

// Semantic recall
const hits = await metu.recall({ query: 'pricing decision' });

// Push a notification to all your devices
await metu.notify({ title: 'Build green', urgency: 'normal' });

// Live channel
const ws = await metu.connect({
  kind: 'external_app',
  platform: 'node',
  name: 'my-app',
  fingerprint: 'my-app-1',
});
ws.on('event.notification', (n) => console.log(n.title));
```

## Auth

Tokens are OAuth 2.1 bearer tokens (`metu_at_*`). Mint one:

- **Interactive**: register an app at `https://app.metu.ro/apps`, then run
  the authorization-code + PKCE flow against `/api/oauth/authorize` +
  `/api/oauth/token`.
- **Devices**: use the device flow (`/api/oauth/device`) — see the
  `oauth` subpath helpers exported by this package.

Scopes gate every endpoint (`capture`, `recall:read`, `notify`,
`tools:invoke`, …). Requests without the required scope return `403`.

## Docs

- SDK quickstart: <https://app.metu.ro/docs/sdk>
- Protocol schemas: [`@metu/protocol`](https://www.npmjs.com/package/@metu/protocol)

## License

MIT
