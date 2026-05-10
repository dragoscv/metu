/**
 * Web → hub HTTP client.
 *
 * Use from server actions / inngest to push live events to connected devices
 * (notifications, tool.invoke, command). Falls back to a no-op if the hub
 * isn't configured — e.g. in unit tests or before infra is wired.
 */
import type { z } from 'zod';
import { type ServerEventSchema } from '@metu/protocol';
import { log } from './logger';

export type ServerEvent = z.infer<typeof ServerEventSchema>;

export type DeviceKindFilter =
  | 'web'
  | 'mobile'
  | 'vscode_ext'
  | 'browser_ext'
  | 'companion_desktop'
  | 'mcp_client'
  | 'external_app'
  | 'cli';

interface BroadcastInput {
  workspaceId: string;
  envelope: ServerEvent;
  kinds?: DeviceKindFilter[];
  deviceIds?: string[];
}

export async function hubBroadcast(input: BroadcastInput): Promise<{ delivered: number } | null> {
  const url = process.env.HUB_URL;
  const secret = process.env.HUB_INTERNAL_SECRET;
  if (!url || !secret) {
    if (process.env.NODE_ENV !== 'production') {
      log.warn('hub.broadcast.unconfigured');
    }
    return null;
  }
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/internal/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-secret': secret,
      },
      body: JSON.stringify(input),
      signal: ac.signal,
    });
    if (!res.ok) {
      log.error('hub.broadcast.failed', {
        status: res.status,
        body: await res.text().catch(() => ''),
      });
      return null;
    }
    const body = (await res.json()) as { ok: boolean; delivered: number };
    return { delivered: body.delivered };
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') {
      log.error('hub.broadcast.timeout', { ms: 5000 });
    } else {
      log.error('hub.broadcast.error', undefined, err);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
