/**
 * Companion app — entry React component.
 *
 * States:
 *   - signed_out: render device-flow pairing UI.
 *   - signed_in:  show connection status + recent activity. Background
 *                 tasks (WS connection, hotkey, tray) live in Rust + the
 *                 `useHubConnection` hook.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AnimatePresence, motion } from 'framer-motion';
import { loadAuth, saveAuth, clearAuth, ensureFreshAuth, type AuthState } from './state/auth';
import { Pairing } from './ui/Pairing';
import { Connected } from './ui/Connected';
import { useHubConnection } from './state/useHubConnection';
import { loadSensorSettings, loadSensorsEnabled, useSensorBridge } from './state/sensors-bridge';
import { useIdleDetection } from './state/useIdleDetection';
import { isObserverMuted } from './state/useObserverMuted';
import { info, warn } from './state/debug';
import { Titlebar } from './ui/Titlebar';
import { Splash } from './ui/Splash';
import { DebugPanel } from './ui/DebugPanel';

export function App() {
  const [auth, setAuth] = useState<AuthState | null | 'loading'>('loading');
  const [sensorsTick, setSensorsTick] = useState(0);
  const [splashGone, setSplashGone] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  // Minimum splash dwell so the wake-up animation never flickers.
  useEffect(() => {
    const t = setTimeout(() => setSplashGone(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // Global Ctrl/Cmd+Shift+D toggles the diagnostics panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setShowDebug((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hub = useHubConnection(auth && auth !== 'loading' ? auth : null);

  // Proactive token refresh — without this the access token expires after an
  // hour, the hub rejects the `hello` (invalid_token), and the UI gets stuck
  // on "Reconnecting…" forever. We check every minute and refresh within the
  // skew window; a rotated token changes `auth.accessToken`, which makes
  // `useHubConnection` reconnect cleanly. A revoked refresh token clears auth
  // and drops back to pairing.
  useEffect(() => {
    if (!auth || auth === 'loading') return;
    let stop = false;
    const check = async () => {
      const current = auth;
      const next = await ensureFreshAuth(current);
      if (stop) return;
      if (!next) {
        warn('auth', 'refresh failed — signing out');
        setAuth(null);
        return;
      }
      if (next.accessToken !== current.accessToken) {
        info('auth', 'access token refreshed');
        setAuth(next);
      }
    };
    void check();
    const id = setInterval(() => void check(), 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [auth]);

  // Sensor bridge — re-read settings whenever the panel bumps `sensorsTick`.
  useSensorBridge(
    hub.sendEnvelope,
    loadSensorsEnabled(),
    loadSensorSettings(),
    hub.status === 'open',
  );
  // sensorsTick is read so React picks up panel edits (the call above
  // closes over fresh values because each render reloads from localStorage).
  void sensorsTick;

  // Window focus events — feed Conductor a coarse 'companion focused/blurred'
  // signal so the activity reactor can correlate "user came back to companion"
  // moments. We send through hub WS only when it's open; no buffering.
  useEffect(() => {
    if (hub.status !== 'open') return;
    const w = getCurrentWindow();
    let unlisten: (() => void) | null = null;
    void w
      .onFocusChanged(({ payload: focused }) => {
        if (isObserverMuted()) return;
        hub.sendEnvelope({
          v: 1,
          type: 'event.device',
          kind: focused ? 'companion.focus.gained' : 'companion.focus.lost',
          payload: { window: w.label },
          occurredAt: new Date().toISOString(),
        });
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [hub.status, hub.sendEnvelope]);

  // Best-effort LAN presence beacon: advertise the paired hub URL via
  // mDNS so other devices on the same network can discover it. Silently
  // ignored on networks without multicast (corporate VPN, container).
  useEffect(() => {
    if (!auth || auth === 'loading') return;
    invoke('mdns_announce', {
      hub: auth.apiBase,
      workspace: auth.workspaceId,
      name: null,
    }).catch(() => {});
    return () => {
      invoke('mdns_stop').catch(() => {});
    };
  }, [auth]);

  // Idle/away — emits `device.companion.{idle|active}` after 5 minutes
  // without input inside the webview. Disabled until the hub is up.
  useIdleDetection((next) => {
    if (isObserverMuted()) return;
    hub.sendEnvelope({
      v: 1,
      type: 'event.device',
      kind: next === 'idle' ? 'companion.idle' : 'companion.active',
      payload: {},
      occurredAt: new Date().toISOString(),
    });
  }, hub.status === 'open');

  const booting = auth === 'loading' || !splashGone;
  const diagContext = {
    signedIn: Boolean(auth && auth !== 'loading'),
    hubStatus: hub.status,
    workspaceId: auth && auth !== 'loading' ? auth.workspaceId : null,
    apiBase: auth && auth !== 'loading' ? auth.apiBase : null,
  };

  return (
    <div className="app-frame">
      <Titlebar onOpenDebug={() => setShowDebug((v) => !v)} />
      <div className="app-body">
        <AnimatePresence mode="wait">
          {booting ? (
            <Splash key="splash" />
          ) : !auth ? (
            <motion.div
              key="pairing"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: '100%' }}
            >
              <Pairing
                onPaired={async (a) => {
                  await saveAuth(a);
                  setAuth(a);
                }}
              />
            </motion.div>
          ) : (
            <motion.div
              key="connected"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              style={{ height: '100%' }}
            >
              <Connected
                auth={auth}
                status={hub.status}
                onSensorsChange={() => setSensorsTick((x) => x + 1)}
                onSignOut={async () => {
                  await clearAuth();
                  setAuth(null);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showDebug && (
          <DebugPanel key="debug" context={diagContext} onClose={() => setShowDebug(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
