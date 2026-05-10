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

export function App() {
  const [auth, setAuth] = useState<AuthState | null | 'loading'>('loading');

  useEffect(() => {
    loadAuth().then(setAuth);
  }, []);

  const status = useHubConnection(auth && auth !== 'loading' ? auth : null);

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
      status={status}
      onSignOut={async () => {
        await clearAuth();
        setAuth(null);
      }}
    />
  );
}
