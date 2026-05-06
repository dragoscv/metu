/**
 * Internal HTTP endpoints — used by the web app (and worker) to push events
 * to connected devices via the hub.
 *
 * Auth: shared secret in `HUB_INTERNAL_SECRET`. In production this lives on a
 * private VPC subnet behind a Cloud Run ingress=internal restriction.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { ServerEventSchema } from '@metu/protocol';
import { registry } from './registry';
import { safeEqual } from './safe-equal';

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
    return c.json({ ok: true, delivered: conns.length });
  });

  app.get('/internal/connections', (c) => {
    return c.json({ ok: true, total: registry.size() });
  });
}
