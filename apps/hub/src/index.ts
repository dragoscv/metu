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
import { log } from '@metu/logger';
import { authenticateHello } from './auth';
import { registerInternalRoutes } from './internal';
import { handleSocket } from './socket';
import { registry } from './registry';
import { consumeHandshakeBudget, exceedsConnectionCap, ipFromReq } from './limits';

const port = Number(process.env.HUB_PORT ?? 24891);

const app = new Hono();

app.get('/', (c) => c.json({ ok: true, service: 'metu-hub', protocol: 1 }));
app.get('/healthz', (c) =>
  c.json({ ok: true, connections: registry.size(), uptimeSec: Math.floor(process.uptime()) }),
);

// Prometheus-style text exposition. Cheap; no auth — exposes counts only.
app.get('/metrics', (c) => {
  const kinds = registry.byKind();
  const lines = [
    '# HELP metu_hub_connections Number of live websocket connections.',
    '# TYPE metu_hub_connections gauge',
    `metu_hub_connections ${registry.size()}`,
    '# HELP metu_hub_workspaces Number of workspaces with a live connection.',
    '# TYPE metu_hub_workspaces gauge',
    `metu_hub_workspaces ${registry.workspaceCount()}`,
    '# HELP metu_hub_connections_by_kind Live connections grouped by device kind.',
    '# TYPE metu_hub_connections_by_kind gauge',
    ...Object.entries(kinds).map(
      ([kind, n]) => `metu_hub_connections_by_kind{kind="${kind.replace(/"/g, '')}"} ${n}`,
    ),
    '# HELP metu_hub_uptime_seconds Hub process uptime in seconds.',
    '# TYPE metu_hub_uptime_seconds counter',
    `metu_hub_uptime_seconds ${Math.floor(process.uptime())}`,
    '',
  ];
  return c.text(lines.join('\n'), 200, { 'content-type': 'text/plain; version=0.0.4' });
});

registerInternalRoutes(app);

const server = serve({ fetch: app.fetch, port }, (info) => {
  log.info('hub.http.listening', { port: info.port });
}) as Server;

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const ip = ipFromReq(req.headers);
  if (exceedsConnectionCap(registry.size())) {
    try {
      ws.close(1013, 'capacity');
    } catch {
      /* ignore */
    }
    return;
  }
  if (!consumeHandshakeBudget(ip)) {
    try {
      ws.close(4008, 'rate_limited');
    } catch {
      /* ignore */
    }
    return;
  }
  handleSocket(ws, req, { authenticateHello }).catch((err) => {
    log.error('hub.socket.error', undefined, err);
    try {
      ws.close(1011, 'internal_error');
    } catch {
      /* ignore */
    }
  });
});

const shutdown = (signal: string) => {
  log.info('hub.shutdown', { signal });
  wss.close();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
