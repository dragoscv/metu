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
import type { AuthState } from './auth';

export type HubStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const FINGERPRINT_KEY = 'metu.companion.fingerprint';

function getOrCreateFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

export function useHubConnection(auth: AuthState | null): HubStatus {
  const [status, setStatus] = useState<HubStatus>('idle');
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!auth) return;
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
      const url = `${auth.hubUrl.replace(/^http/, 'ws')}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        retryRef.current = 0;
        ws.send(
          JSON.stringify({
            v: 1,
            type: 'hello',
            accessToken: auth.accessToken,
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
          const n = m as { title: string; body?: string };
          let granted = await isPermissionGranted();
          if (!granted) granted = (await requestPermission()) === 'granted';
          if (granted) {
            await sendNotification({ title: n.title, body: n.body ?? '' });
          }
          return;
        }
      });

      ws.addEventListener('close', () => {
        setStatus('closed');
        if (cancelledRef.current) return;
        const delay = Math.min(30_000, 1000 * 2 ** retryRef.current++);
        setTimeout(connect, delay);
      });
      ws.addEventListener('error', () => {
        setStatus('error');
      });
    };

    connect();
    return () => {
      cancelledRef.current = true;
      wsRef.current?.close();
    };
  }, [auth?.accessToken, auth?.hubUrl]);

  return status;
}
