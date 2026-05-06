/**
 * apps/hub — METU realtime gateway.
 *
 * Responsibilities (v1):
 *   - Terminate WebSocket connections from web/mobile/companion/extensions.
 *   - Authenticate the `hello` envelope using OAuth access tokens issued by web.
 *   - Upsert + maintain the `device` row, mark presence online/offline.
 *   - Fan out server-pushed events (notifications, tool.invoke) to subscribed
 *     devices via an internal HTTP endpoint posted to by the web app.
 *   - Persist `device.event` rows when clients emit `event.device`/`event.app`.
 *
 * Auth model: tokens are sha256-hashed in DB (`oauthToken.tokenHash`). We
 * recompute the hash here and look up the row directly — no extra service
 * boundary. The hub is the only thing besides the web app that touches the
 * `device` and `device_event` tables in the hot path.
 */
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { authenticateHello } from './auth';
import { registerInternalRoutes } from './internal';
import { handleSocket } from './socket';
import { registry } from './registry';

const port = Number(process.env.HUB_PORT ?? 3001);

const app = new Hono();

app.get('/', (c) => c.json({ ok: true, service: 'metu-hub', protocol: 1 }));
app.get('/healthz', (c) =>
  c.json({ ok: true, connections: registry.size(), uptimeSec: Math.floor(process.uptime()) }),
);

registerInternalRoutes(app);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[hub] http+ws listening on :${info.port}`);
}) as Server;

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  handleSocket(ws, req, { authenticateHello }).catch((err) => {
    console.error('[hub] socket error', err);
    try {
      ws.close(1011, 'internal_error');
    } catch {
      /* ignore */
    }
  });
});

const shutdown = (signal: string) => {
  console.log(`[hub] ${signal} — shutting down`);
  wss.close();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
