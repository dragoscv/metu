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
import { loadAuth, saveAuth, clearAuth, type AuthState } from './state/auth';
import { Pairing } from './ui/Pairing';
import { Connected } from './ui/Connected';
import { useHubConnection } from './state/useHubConnection';
import { loadSensorSettings, loadSensorsEnabled, useSensorBridge } from './state/sensors-bridge';

export function App() {
  const [auth, setAuth] = useState<AuthState | null | 'loading'>('loading');
  const [sensorsTick, setSensorsTick] = useState(0);

  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  const hub = useHubConnection(auth && auth !== 'loading' ? auth : null);

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

  if (auth === 'loading') {
    return (
      <div className="shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!auth) {
    return (
      <Pairing
        onPaired={async (a) => {
          await saveAuth(a);
          setAuth(a);
        }}
      />
    );
  }

  return (
    <Connected
      auth={auth}
      status={hub.status}
      onSensorsChange={() => setSensorsTick((x) => x + 1)}
      onSignOut={async () => {
        await clearAuth();
        setAuth(null);
      }}
    />
  );
}
