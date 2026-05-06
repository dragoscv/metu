/**
 * Web → hub HTTP client.
 *
 * Use from server actions / inngest to push live events to connected devices
 * (notifications, tool.invoke, command). Falls back to a no-op if the hub
 * isn't configured — e.g. in unit tests or before infra is wired.
 */
import type { z } from 'zod';
import { type ServerEventSchema } from '@metu/protocol';

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
      console.warn('[hub] HUB_URL/HUB_INTERNAL_SECRET unset — broadcast skipped');
    }
    return null;
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/internal/broadcast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-secret': secret,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      console.error('[hub] broadcast failed', res.status, await res.text().catch(() => ''));
      return null;
    }
    const body = (await res.json()) as { ok: boolean; delivered: number };
    return { delivered: body.delivered };
  } catch (err) {
    console.error('[hub] broadcast error', err);
    return null;
  }
}
