/**
 * Internal /internal/broadcast route tests — in-process Hono app, fake
 * registry connections (no real ws, no DB). Verifies secret auth,
 * envelope validation, and kind/deviceId filtering.
 */
import { describe, expect, it, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { registry, type Connection } from '../registry';
import { registerInternalRoutes } from '../internal';

const SECRET = 'test-hub-secret-0123456789abcdef';

let app: Hono;

function fakeConn(over: Partial<Connection> & { sent?: unknown[] }): Connection & {
  sent: unknown[];
} {
  const sent: unknown[] = over.sent ?? [];
  return {
    ws: {} as Connection['ws'],
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'u1',
    deviceId: crypto.randomUUID(),
    kind: 'web',
    send: (p: unknown) => sent.push(p),
    ...over,
    sent,
  };
}

const validEnvelope = {
  type: 'event.notification',
  id: '22222222-2222-4222-8222-222222222222',
  title: 'hello',
};

function broadcast(body: unknown, secret: string | null = SECRET) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-hub-secret'] = secret;
  return app.request('/internal/broadcast', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.HUB_INTERNAL_SECRET = SECRET;
  app = new Hono();
  registerInternalRoutes(app);
});

beforeEach(() => {
  // registry is a module singleton — clear all test workspaces.
  for (const ws of ['11111111-1111-4111-8111-111111111111']) {
    for (const c of registry.forWorkspace(ws)) registry.remove(c);
  }
});

describe('/internal/* auth', () => {
  it('rejects a missing secret with 401', async () => {
    const res = await broadcast({}, null);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong secret with 401', async () => {
    const res = await broadcast({}, 'wrong-secret');
    expect(res.status).toBe(401);
  });

  it('GET /internal/connections returns total with valid secret', async () => {
    const res = await app.request('/internal/connections', {
      headers: { 'x-hub-secret': SECRET },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; total: number };
    expect(json.ok).toBe(true);
    expect(typeof json.total).toBe('number');
  });
});

describe('POST /internal/broadcast', () => {
  it('rejects an invalid envelope with 400', async () => {
    const res = await broadcast({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      envelope: { v: 1, type: 'not.a.thing' },
    });
    expect(res.status).toBe(400);
  });

  it('delivers to all connections in the workspace', async () => {
    const a = fakeConn({});
    const b = fakeConn({ kind: 'mobile' });
    registry.add(a);
    registry.add(b);

    const res = await broadcast({
      workspaceId: a.workspaceId,
      envelope: validEnvelope,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { delivered: number };
    expect(json.delivered).toBe(2);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('filters by kinds', async () => {
    const web = fakeConn({ kind: 'web' });
    const companion = fakeConn({ kind: 'companion_desktop' });
    registry.add(web);
    registry.add(companion);

    const res = await broadcast({
      workspaceId: web.workspaceId,
      kinds: ['companion_desktop'],
      envelope: validEnvelope,
    });
    const json = (await res.json()) as { delivered: number };
    expect(json.delivered).toBe(1);
    expect(web.sent).toHaveLength(0);
    expect(companion.sent).toHaveLength(1);
  });

  it('filters by deviceIds', async () => {
    const a = fakeConn({});
    const b = fakeConn({});
    registry.add(a);
    registry.add(b);

    const res = await broadcast({
      workspaceId: a.workspaceId,
      deviceIds: [b.deviceId],
      envelope: validEnvelope,
    });
    const json = (await res.json()) as { delivered: number };
    expect(json.delivered).toBe(1);
    expect(a.sent).toHaveLength(0);
    expect(b.sent).toHaveLength(1);
  });

  it('delivers nothing for an unknown workspace', async () => {
    const res = await broadcast({
      workspaceId: '33333333-3333-4333-8333-333333333333',
      envelope: validEnvelope,
    });
    const json = (await res.json()) as { delivered: number };
    expect(json.delivered).toBe(0);
  });
});
