/**
 * WebSocket lifecycle: handshake → message loop → cleanup.
 *
 * Wire format: text frames carrying JSON. First message MUST validate against
 * `HelloSchema`; we reply with `HelloAckSchema` and then accept envelopes
 * matching `ClientEventSchema`. Anything else closes the socket.
 */
import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import { getDb } from '@metu/db';
import { device, deviceEvent } from '@metu/db/schema';
import { eq } from 'drizzle-orm';
import { ClientEventSchema, HelloSchema, PROTOCOL_VERSION } from '@metu/protocol';
import { log } from '@metu/logger';
import type { AuthenticatedToken } from './auth';
import { registry, type Connection } from './registry';
import { consumeConnBudget, newConnBudget, MAX_FRAME_BYTES } from './limits';

const PING_INTERVAL_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * Sensitive device kinds locked to specific OAuth client ids. Override via
 * env so non-prod / staging can use different client rows.
 */
const REQUIRED_CLIENT_FOR_KIND: Partial<Record<string, string>> = {
  companion_desktop: process.env.METU_COMPANION_CLIENT_ID ?? 'metu_app_companion',
};

export interface SocketDeps {
  authenticateHello: (token: string) => Promise<AuthenticatedToken | null>;
}

export async function handleSocket(
  ws: WebSocket,
  _req: IncomingMessage,
  deps: SocketDeps,
): Promise<void> {
  const send = (payload: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  };

  let conn: Connection | null = null;
  let pingTimer: NodeJS.Timeout | null = null;
  const budget = newConnBudget();

  const handshakeTimer = setTimeout(() => {
    if (!conn) {
      send({ v: 1, type: 'error', error: 'handshake_timeout' });
      ws.close(4001, 'handshake_timeout');
    }
  }, HANDSHAKE_TIMEOUT_MS);

  ws.on('message', async (raw) => {
    // Reject oversized frames before parsing.
    const buf = raw as Buffer;
    if (buf.byteLength > MAX_FRAME_BYTES) {
      send({ v: 1, type: 'error', error: 'frame_too_large' });
      ws.close(1009, 'frame_too_large');
      return;
    }
    if (!consumeConnBudget(budget)) {
      send({ v: 1, type: 'error', error: 'rate_limited' });
      ws.close(4008, 'rate_limited');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(buf.toString());
    } catch {
      send({ v: 1, type: 'error', error: 'invalid_json' });
      return;
    }

    // First message: hello.
    if (!conn) {
      const parsed = HelloSchema.safeParse(json);
      if (!parsed.success) {
        send({ v: 1, type: 'error', error: 'invalid_hello' });
        ws.close(4002, 'invalid_hello');
        return;
      }
      const hello = parsed.data;
      const token = await deps.authenticateHello(hello.accessToken);
      if (!token) {
        send({ v: 1, type: 'error', error: 'invalid_token' });
        ws.close(4003, 'invalid_token');
        return;
      }

      // Bind sensitive device kinds to specific OAuth client ids so a
      // leaked access token from any other client cannot impersonate a
      // companion or vscode-ext (which may have richer ACLs).
      const requiredClientId = REQUIRED_CLIENT_FOR_KIND[hello.kind];
      if (requiredClientId && token.clientId !== requiredClientId) {
        send({
          v: 1,
          type: 'error',
          error: 'kind_clientid_mismatch',
        });
        ws.close(4003, 'kind_clientid_mismatch');
        return;
      }

      const db = getDb();
      // Atomic upsert keyed by the existing unique index
      // (workspaceId, userId, fingerprint) — no read-then-write race.
      const [row] = await db
        .insert(device)
        .values({
          workspaceId: token.workspaceId,
          userId: token.userId,
          kind: hello.kind,
          platform: hello.platform,
          name: hello.name,
          fingerprint: hello.fingerprint,
          version: hello.version ?? null,
          capabilities: hello.capabilities,
          presence: 'online',
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [device.workspaceId, device.userId, device.fingerprint],
          set: {
            kind: hello.kind,
            platform: hello.platform,
            name: hello.name,
            version: hello.version ?? null,
            capabilities: hello.capabilities,
            presence: 'online',
            lastSeenAt: new Date(),
          },
        })
        .returning();
      const deviceId: string = row!.id;

      clearTimeout(handshakeTimer);

      conn = {
        ws,
        workspaceId: token.workspaceId,
        userId: token.userId,
        deviceId,
        kind: hello.kind,
        send,
      };
      registry.add(conn);

      send({
        v: PROTOCOL_VERSION,
        type: 'hello_ack',
        deviceId,
        workspaceId: token.workspaceId,
        userId: token.userId,
        acl: {},
        serverTime: new Date().toISOString(),
      });

      pingTimer = setInterval(() => {
        send({ type: 'ping', at: new Date().toISOString() });
      }, PING_INTERVAL_MS);

      return;
    }

    // Subsequent messages: client envelopes.
    const parsed = ClientEventSchema.safeParse(json);
    if (!parsed.success) {
      send({ v: 1, type: 'error', error: 'invalid_envelope' });
      return;
    }
    const ev = parsed.data;
    const db = getDb();

    switch (ev.type) {
      case 'event.app':
      case 'event.device': {
        await db.insert(deviceEvent).values({
          workspaceId: conn.workspaceId,
          deviceId: conn.deviceId,
          kind: ev.kind,
          payload: ev.payload,
          occurredAt: ev.occurredAt ? new Date(ev.occurredAt) : new Date(),
        });
        break;
      }
      case 'presence': {
        await db
          .update(device)
          .set({
            presence: ev.state,
            activity: ev.activity ?? {},
            lastSeenAt: new Date(),
          })
          .where(eq(device.id, conn.deviceId));
        break;
      }
      case 'pong': {
        await db.update(device).set({ lastSeenAt: new Date() }).where(eq(device.id, conn.deviceId));
        break;
      }
      case 'tool.result': {
        // Forward to the web app so it can persist the result on `tool_call`
        // and tick the Conductor. The hub itself is stateless wrt tool calls.
        const url = process.env.WEB_INTERNAL_URL;
        const secret = process.env.HUB_INTERNAL_SECRET;
        if (url && secret) {
          try {
            await fetch(`${url.replace(/\/$/, '')}/api/internal/hub/tool-result`, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-hub-secret': secret,
              },
              body: JSON.stringify({
                workspaceId: conn.workspaceId,
                deviceId: conn.deviceId,
                toolCallId: ev.id,
                ok: ev.ok,
                result: ev.result,
                error: ev.error,
              }),
            });
          } catch (err) {
            log.error('hub.tool_result.forward_failed', { toolCallId: ev.id }, err);
          }
        }
        break;
      }
    }
  });

  const cleanup = async () => {
    clearTimeout(handshakeTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (conn) {
      registry.remove(conn);
      try {
        const db = getDb();
        await db
          .update(device)
          .set({ presence: 'offline', lastSeenAt: new Date() })
          .where(eq(device.id, conn.deviceId));
      } catch (err) {
        log.error('hub.device.mark_offline_failed', { deviceId: conn.deviceId }, err);
      }
    }
  };

  ws.on('close', () => void cleanup());
  ws.on('error', () => void cleanup());
}
