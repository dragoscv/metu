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
  const cancelledRef = useRef(false);

  const accessToken = auth?.accessToken;
  const hubUrl = auth?.hubUrl;
  useEffect(() => {
    if (!accessToken || !hubUrl) return;
    cancelledRef.current = false;
    const fingerprint = getOrCreateFingerprint();
    let plat: string = 'unknown';
    try {
      plat = platform();
    } catch {
      /* ignore */
    }

    const connect = () => {
      if (cancelledRef.current) return;
      setStatus('connecting');
      const url = `${hubUrl.replace(/^http/, 'ws')}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        // Ignore events from a socket we've already replaced/closed.
        if (wsRef.current !== ws || cancelledRef.current) return;
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
        if (wsRef.current !== ws || cancelledRef.current) return;
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
          // Let the desktop pet react in-character to conductor messages.
          void emit('metu://pet-notify', {
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
        if (wsRef.current !== ws || cancelledRef.current) return;
        setStatus('closed');
        const delay = Math.min(30_000, 1000 * 2 ** retryRef.current++);
        setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        if (wsRef.current !== ws || cancelledRef.current) return;
        setStatus('error');
      });
    };

    connect();
    return () => {
      cancelledRef.current = true;
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
