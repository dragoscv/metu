/**
 * Seamless OAuth pairing for the companion app (RFC 8252 loopback redirect).
 *
 * One click:
 *   1. Ask Rust to bind an ephemeral 127.0.0.1 port → loopback redirect_uri.
 *   2. Generate a PKCE verifier/challenge + random state.
 *   3. Open the system browser at /api/oauth/authorize (auth-code + PKCE).
 *      The companion is a trusted first-party client, so after the user signs
 *      in the server auto-approves and 302-redirects to the loopback URI.
 *   4. Rust's one-shot HTTP server captures ?code=…; we exchange it at
 *      /api/oauth/token with the verifier, then call /userinfo and persist.
 *
 * No custom URI scheme (deep link), no code typing, no polling — the flow
 * completes the instant the browser redirect lands on our local listener.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import type { AuthState } from '../state/auth';
import { ShaderOrb } from '../avatar/ShaderOrb';
import { useAvatarSelection } from '../avatar/useAvatarSelection';

const DEFAULT_API = import.meta.env.VITE_METU_API ?? 'http://localhost:24890';
const DEFAULT_HUB = import.meta.env.VITE_METU_HUB ?? 'http://localhost:24891';
const CLIENT_ID = import.meta.env.VITE_METU_COMPANION_CLIENT_ID ?? 'metu_app_companion';
const SCOPES =
  'openid profile email offline_access capture:write recall:read notify:write notify:read event:write event:read tools:invoke audit:read presence:talk';

const AUTH_TIMEOUT_SECS = 300;

interface LoopbackStart {
  port: number;
  redirect_uri: string;
}
interface LoopbackResult {
  code: string | null;
  state: string | null;
  error: string | null;
}
interface PairedAuth {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  workspace_id: string;
  user_id: string;
}

// ─── PKCE helpers (Web Crypto, available in the Tauri webview) ───────────────
function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomB64Url(byteLen: number): string {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return base64Url(a);
}
async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function Pairing({ onPaired }: { onPaired: (a: AuthState) => Promise<void> }) {
  const [api, setApi] = useState(DEFAULT_API);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const { selection } = useAvatarSelection();

  async function connect() {
    setError(null);
    setPhase('connecting');
    let port: number | null = null;
    try {
      // 1. Loopback listener.
      const lb = await invoke<LoopbackStart>('oauth_loopback_start');
      port = lb.port;

      // 2. PKCE + state.
      const verifier = randomB64Url(64);
      const challenge = await pkceChallenge(verifier);
      const state = randomB64Url(16);

      // 3. Open the browser at the authorize endpoint.
      const authUrl = new URL(`${api}/api/oauth/authorize`);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', lb.redirect_uri);
      authUrl.searchParams.set('scope', SCOPES);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      await openExternal(authUrl.toString());

      // 4. Wait for the browser redirect to hit our local listener.
      const cb = await invoke<LoopbackResult>('oauth_loopback_wait', {
        port,
        timeoutSecs: AUTH_TIMEOUT_SECS,
      });
      port = null; // consumed
      if (cb.error) throw new Error(cb.error);
      if (!cb.code) throw new Error('no authorization code returned');
      if (cb.state !== state) throw new Error('state mismatch (possible CSRF)');

      // 5. Exchange the code + resolve identity in Rust (bypasses webview CORS;
      //    the OAuth token/userinfo endpoints are not CORS-enabled).
      const paired = await invoke<PairedAuth>('oauth_exchange', {
        apiBase: api,
        code: cb.code,
        verifier,
        redirectUri: lb.redirect_uri,
        clientId: CLIENT_ID,
      });

      await onPaired({
        accessToken: paired.access_token,
        refreshToken: paired.refresh_token ?? null,
        expiresAt: Date.now() + (paired.expires_in ?? 3600) * 1000,
        workspaceId: paired.workspace_id,
        userId: paired.user_id,
        apiBase: api,
        hubUrl: DEFAULT_HUB,
      });
    } catch (e) {
      if (port != null) invoke('oauth_loopback_cancel', { port }).catch(() => {});
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  return (
    <div className="pairing">
      <motion.div
        className="pairing__orb"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 18 }}
      >
        <ShaderOrb
          state={phase === 'connecting' ? 'listening' : 'idle'}
          size={120}
          presetId={selection.orbPresetId}
        />
      </motion.div>

      <h1 className="pairing__title">Connect to metu</h1>
      <p className="pairing__sub">
        We'll open your browser to sign in, then bring you right back. No codes to type.
      </p>

      <div className="glass-card pairing__card">
        {phase === 'idle' && (
          <>
            <button className="btn-primary" onClick={connect}>
              Connect
            </button>
            <button className="chip" onClick={() => setShowAdvanced((v) => !v)}>
              {showAdvanced ? 'Hide advanced' : 'Advanced'}
            </button>
            {showAdvanced && (
              <div style={{ width: '100%', textAlign: 'left' }}>
                <label className="muted" style={{ display: 'block', marginBottom: 6 }}>
                  Server
                </label>
                <input className="field" value={api} onChange={(e) => setApi(e.target.value)} />
              </div>
            )}
          </>
        )}

        {phase === 'connecting' && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Waiting for you to finish in the browser…
            </p>
            <button className="chip" onClick={() => setPhase('idle')}>
              Cancel
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <p style={{ color: '#fca5a5', margin: 0 }}>Pairing failed: {error}</p>
            <button className="chip" onClick={() => setPhase('idle')}>
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
