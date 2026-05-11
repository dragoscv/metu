/**
 * Internal HTTP endpoints — used by the web app (and worker) to push events
 * to connected devices via the hub.
 *
 * Auth: shared secret in `HUB_INTERNAL_SECRET`. In production this lives on a
 * private VPC subnet behind a Cloud Run ingress=internal restriction.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ServerEventSchema } from '@metu/protocol';
import { registry } from './registry';
import { publish, subscribe } from './redis-fanout';
import { safeEqual } from './safe-equal';

// Per-process id so multi-instance fanout subscribers can ignore their
// own publishes (the originating instance already delivered locally).
const HUB_INSTANCE_ID = randomUUID();

const broadcastSchema = z.object({
  workspaceId: z.string().uuid(),
  /** Optional filter: only deliver to these device kinds. */
  kinds: z
    .array(
      z.enum([
        'web',
        'mobile',
        'vscode_ext',
        'browser_ext',
        'companion_desktop',
        'mcp_client',
        'external_app',
        'cli',
      ]),
    )
    .optional(),
  /** Optional filter: only deliver to these device ids. */
  deviceIds: z.array(z.string().uuid()).optional(),
  envelope: ServerEventSchema,
});

export function registerInternalRoutes(app: Hono) {
  app.use('/internal/*', async (c, next) => {
    const secret = process.env.HUB_INTERNAL_SECRET;
    if (!secret) return c.json({ ok: false, error: 'hub_internal_secret_unset' }, 500);
    const provided = c.req.header('x-hub-secret');
    if (!safeEqual(provided, secret)) return c.json({ ok: false, error: 'unauthorized' }, 401);
    await next();
  });

  app.post('/internal/broadcast', async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = broadcastSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' }, 400);
    }
    const { workspaceId, kinds, deviceIds, envelope } = parsed.data;
    const conns = registry
      .forWorkspace(workspaceId)
      .filter((c) => (kinds ? kinds.includes(c.kind as (typeof kinds)[number]) : true))
      .filter((c) => (deviceIds ? deviceIds.includes(c.deviceId) : true));
    for (const conn of conns) conn.send(envelope);

    // Best-effort fanout to peer hub instances. No-op when Redis isn't
    // configured. Errors are swallowed inside `publish` so a Redis
    // outage never breaks the local-delivery happy path.
    void publish({
      id: randomUUID(),
      origin: HUB_INSTANCE_ID,
      workspaceId,
      kinds,
      deviceIds,
      envelope,
    });

    return c.json({ ok: true, delivered: conns.length });
  });

  app.get('/internal/connections', (c) => {
    return c.json({ ok: true, total: registry.size() });
  });

  // Deliver envelopes published by peer hub instances to our local
  // connections. No-op when Redis isn't configured.
  subscribe((msg) => {
    if (msg.workspaceId == null) return;
    // Skip our own publishes — local fast path already delivered them.
    if (msg.origin === HUB_INSTANCE_ID) return;
    const conns = registry
      .forWorkspace(msg.workspaceId)
      .filter((c) => (msg.kinds ? msg.kinds.includes(c.kind) : true))
      .filter((c) => (msg.deviceIds ? msg.deviceIds.includes(c.deviceId) : true));
    for (const conn of conns) conn.send(msg.envelope);
  });
}
