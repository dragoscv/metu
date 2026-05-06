/**
 * Device-flow pairing for the companion app.
 *
 * 1. POST /api/oauth/device → user_code + verification_uri.
 * 2. Open the verification URL in the system browser via `tauri-plugin-shell`.
 * 3. Poll /api/oauth/token until user approves.
 * 4. Hit /api/oauth/userinfo to grab workspaceId/userId. Persist via store.
 */
import { useState } from 'react';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import type { AuthState } from '../state/auth';

const DEFAULT_API = import.meta.env.VITE_METU_API ?? 'http://localhost:3000';
const DEFAULT_HUB = import.meta.env.VITE_METU_HUB ?? 'http://localhost:3001';
const CLIENT_ID = import.meta.env.VITE_METU_COMPANION_CLIENT_ID ?? 'metu_app_companion';
const SCOPES =
  'openid profile email offline_access capture:write recall:read notify:write notify:read event:write tools:invoke';

interface DeviceCodeResp {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResp {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface UserInfoResp {
  sub: string;
  metu_workspace_id: string;
}

export function Pairing({ onPaired }: { onPaired: (a: AuthState) => Promise<void> }) {
  const [api, setApi] = useState(DEFAULT_API);
  const [phase, setPhase] = useState<'idle' | 'awaiting' | 'polling' | 'error'>('idle');
  const [code, setCode] = useState<DeviceCodeResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setPhase('awaiting');
    try {
      const res = await fetch(`${api}/api/oauth/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPES }).toString(),
      });
      if (!res.ok) throw new Error(`device endpoint ${res.status}`);
      const dc = (await res.json()) as DeviceCodeResp;
      setCode(dc);
      await openExternal(dc.verification_uri_complete);
      setPhase('polling');
      pollToken(dc).catch((e) => {
        setError(String(e));
        setPhase('error');
      });
    } catch (e) {
      setError(String(e));
      setPhase('error');
    }
  }

  async function pollToken(dc: DeviceCodeResp) {
    const deadline = Date.now() + dc.expires_in * 1000;
    let interval = dc.interval * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      const res = await fetch(`${api}/api/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: dc.device_code,
          client_id: CLIENT_ID,
        }).toString(),
      });
      const body = (await res.json()) as { error?: string } & Partial<TokenResp>;
      if (res.ok && body.access_token) {
        const ui = await fetch(`${api}/api/oauth/userinfo`, {
          headers: { authorization: `Bearer ${body.access_token}` },
        });
        if (!ui.ok) throw new Error('userinfo failed');
        const u = (await ui.json()) as UserInfoResp;
        await onPaired({
          accessToken: body.access_token,
          refreshToken: body.refresh_token ?? null,
          expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
          workspaceId: u.metu_workspace_id,
          userId: u.sub,
          apiBase: api,
          hubUrl: DEFAULT_HUB,
        });
        return;
      }
      if (body.error === 'authorization_pending') continue;
      if (body.error === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw new Error(body.error ?? 'token exchange failed');
    }
    throw new Error('device code expired');
  }

  return (
    <div className="shell">
      <h1 className="title">Pair this device</h1>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Sign in to METU. We'll open your browser for approval.
        </p>
        {phase === 'idle' && (
          <>
            <label className="muted">Server</label>
            <input
              value={api}
              onChange={(e) => setApi(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                marginTop: 6,
                marginBottom: 12,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(0,0,0,0.25)',
                color: 'white',
              }}
            />
            <button className="btn" onClick={start}>
              Start pairing
            </button>
          </>
        )}
        {(phase === 'awaiting' || phase === 'polling') && code && (
          <>
            <p className="muted">Enter this code in your browser:</p>
            <div className="code">{code.user_code}</div>
            <p className="muted" style={{ marginTop: 12 }}>
              {phase === 'polling' ? 'Waiting for approval…' : 'Opening browser…'}
            </p>
          </>
        )}
        {phase === 'error' && (
          <>
            <p style={{ color: '#fca5a5' }}>Pairing failed: {error}</p>
            <button className="btn ghost" onClick={() => setPhase('idle')}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
