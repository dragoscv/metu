/**
 * WS hub connection lifecycle.
 *
 * Opens a single persistent socket to ${hubUrl}/ws, sends the OAuth `hello`
 * envelope, and handles `event.notification` by dispatching a Tauri OS-level
 * notification (the "slider"). Reconnects with capped exponential backoff.
 */
import { useEffect, useRef, useState } from 'react';
import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification';
import { platform } from '@tauri-apps/plugin-os';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { emit } from '@tauri-apps/api/event';
import type { AuthState } from './auth';
import { executeDeviceTool } from './device-tools';
import { pushHubNotification } from './hub-notifications';
import { pushAwareness } from './awareness';

export type HubStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface HubHandle {
  status: HubStatus;
  /**
   * Send a client envelope over the open socket. Returns true when the
   * frame was queued onto the socket, false when the connection is not
   * yet open (caller may drop, retry, or buffer).
   */
  sendEnvelope: (envelope: Record<string, unknown>) => boolean;
}

const FINGERPRINT_KEY = 'metu.companion.fingerprint';

function getOrCreateFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

export function useHubConnection(auth: AuthState | null): HubHandle {
  const [status, setStatus] = useState<HubStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  // Mirror of `status` for timers that must not close over stale state.
  const statusRef = useRef<HubStatus>('idle');
  statusRef.current = status;

  const accessToken = auth?.accessToken;
  const hubUrl = auth?.hubUrl;
  useEffect(() => {
    if (!accessToken || !hubUrl) return;
    // Per-generation cancellation. This MUST be a local (not a shared ref):
    // a shared ref gets reset to `false` when the effect re-runs after a
    // token refresh, which would revive the previous generation's pending
    // retry timer — a zombie reconnect loop with a stale token that clobbers
    // the live socket and pins the UI on "Reconnecting…".
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const fingerprint = getOrCreateFingerprint();
    let plat: string = 'unknown';
    try {
      plat = platform();
    } catch {
      /* ignore */
    }

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const url = `${hubUrl.replace(/^http/, 'ws')}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        // Ignore events from a socket we've already replaced/closed.
        if (wsRef.current !== ws || cancelled) return;
        retryRef.current = 0;
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'hello',
            accessToken: accessToken,
            kind: 'companion_desktop',
            platform: plat,
            name: `METU Companion (${plat})`,
            fingerprint,
            version: '0.0.1',
            capabilities: ['notifications', 'tool.invoke', 'global_hotkey'],
          }),
        );
      });

      ws.addEventListener('message', async (ev) => {
        // A stale socket (already superseded by a reconnect) must not mutate
        // status — otherwise its late frames clobber the live connection.
        if (wsRef.current !== ws || cancelled) return;
        let msg: unknown;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const m = msg as { type?: string; [k: string]: unknown };
        if (m.type === 'hello_ack') {
          setStatus('open');
          return;
        }
        if (m.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', at: new Date().toISOString() }));
          return;
        }
        if (m.type === 'event.notification') {
          const n = m as {
            id: string;
            title: string;
            body?: string;
            urgency?: 'low' | 'normal' | 'high' | 'critical';
            actionUrl?: string;
          };
          const urgency = n.urgency ?? 'normal';
          pushHubNotification({
            at: Date.now(),
            id: n.id,
            title: n.title,
            body: n.body,
            urgency,
            actionUrl: n.actionUrl,
          });
          // Let the desktop assistant react in-character to conductor messages.
          void emit('metu://assistant-notify', {
            title: n.title,
            body: n.body,
            urgency,
            actionUrl: n.actionUrl,
          }).catch(() => {});
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (granted) {
            await sendNotification({
              title: n.title,
              body: n.body ?? '',
              silent: urgency === 'low',
            });
          }
          // Critical urgency auto-opens the action URL in the user's browser.
          if (urgency === 'critical' && n.actionUrl) {
            const base = import.meta.env.VITE_METU_WEB_URL ?? 'https://app.metu.ro';
            const url = n.actionUrl.startsWith('http') ? n.actionUrl : `${base}${n.actionUrl}`;
            try {
              await openUrl(url);
            } catch {
              /* ignore — user can still see the toast */
            }
          }
          return;
        }
        if (m.type === 'event.timeline') {
          const t = m as {
            kind: string;
            title: string;
            payload?: { sourceDeviceId?: string; deviceId?: string };
            occurredAt?: string;
          };
          // Skip our own events — fingerprint matches the ws hello.kind
          // mapping in the hub registry, which echoes deviceId for the
          // originating connection. Without a perfect device-id round-trip,
          // we suppress only by deviceId === fingerprint stored locally.
          const own = localStorage.getItem('metu.companion.fingerprint') ?? '';
          const src = t.payload?.sourceDeviceId ?? t.payload?.deviceId ?? '';
          if (src && own && src === own) return;
          pushAwareness({
            kind: t.kind,
            title: t.title,
            sourceDeviceId: src,
            occurredAt: t.occurredAt ? new Date(t.occurredAt).getTime() : Date.now(),
          });
          return;
        }
        if (m.type === 'tool.invoke') {
          const inv = m as {
            id: string;
            tool: string;
            args?: Record<string, unknown>;
          };
          let ok = false;
          let result: unknown = null;
          let error: string | undefined;
          try {
            result = await executeDeviceTool(inv.tool, inv.args ?? {});
            ok = true;
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
          ws.send(
            JSON.stringify({
              v: 1,
              type: 'tool.result',
              id: inv.id,
              ok,
              result,
              error,
            }),
          );
          return;
        }
      });

      ws.addEventListener('close', () => {
        // A superseded socket closing is expected during reconnect/StrictMode
        // remount — it must NOT flip status or schedule a retry, or it will
        // clobber the live socket that already reported `open`.
        if (wsRef.current !== ws || cancelled) return;
        setStatus('closed');
        // Cap the exponent so the backoff math can't overflow into a 0/NaN
        // delay after many hours of failed retries (2**1024 === Infinity).
        const attempt = Math.min(retryRef.current++, 5);
        const delay = Math.min(30_000, 1000 * 2 ** attempt);
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        if (wsRef.current !== ws || cancelled) return;
        setStatus('error');
      });

      // Hello watchdog: if the hub never ACKs within 15s (half-open socket,
      // proxy that accepted TCP but the app is wedged, token rejected without
      // a close frame), force-close so the `close` handler reschedules. This
      // is the cure for the indefinite "Reconnecting…" state — a socket that
      // connects but never completes the handshake previously sat in
      // `connecting` forever with no timer running.
      const helloWatchdog = setTimeout(() => {
        if (wsRef.current !== ws || cancelled) return;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          // Only kill it if we never got hello_ack (status still connecting).
          // statusRef avoids stale closure over `status`.
          if (statusRef.current !== 'open') {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          }
        }
      }, 15_000);
      ws.addEventListener('close', () => clearTimeout(helloWatchdog), { once: true });
    };

    connect();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, [accessToken, hubUrl]);

  const sendEnvelope = (envelope: Record<string, unknown>): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  };

  return { status, sendEnvelope };
}
