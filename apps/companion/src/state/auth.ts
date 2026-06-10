/**
 * Persistent auth store backed by `tauri-plugin-store` (encrypted at rest on
 * macOS keychain / Windows credential manager; AES on Linux).
 *
 * We persist:
 *   - accessToken / refreshToken / expiresAt — the OAuth bearer used for both
 *     /api/sdk/v1/* HTTP and the WS handshake.
 *   - workspaceId / userId — server-confirmed identifiers from /userinfo.
 *   - apiBase / hubUrl — endpoints (defaults baked in but overridable for
 *     self-hosted instances).
 */
import { Store } from '@tauri-apps/plugin-store';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';

export interface AuthState {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  workspaceId: string;
  userId: string;
  apiBase: string;
  hubUrl: string;
}

const FILE = 'auth.json';
const KEY = 'auth';

let store: Store | null = null;
async function getStore(): Promise<Store> {
  if (!store) store = await Store.load(FILE, { autoSave: true, defaults: {} });
  return store;
}

export async function loadAuth(): Promise<AuthState | null> {
  // Guard: if Tauri is not available, return null (browser-only dev mode).
  if (!isTauri()) return null;
  const s = await getStore();
  const v = await s.get<AuthState>(KEY);
  if (!v) return null;
  return v;
}

export async function saveAuth(v: AuthState): Promise<void> {
  const s = await getStore();
  await s.set(KEY, v);
  await s.save();
}

export async function clearAuth(): Promise<void> {
  const s = await getStore();
  await s.delete(KEY);
  await s.save();
}

/** OAuth public client id used by the companion (matches the seeded row). */
const CLIENT_ID = 'metu_app_companion';

/** Refresh the access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 5 * 60 * 1000; // 5 min

interface RefreshedAuth {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}

/**
 * Return a valid (non-expired) AuthState, transparently refreshing the access
 * token via the Rust `oauth_refresh` command when it's within the skew window.
 *
 * The refresh runs in Rust to dodge the webview CORS restriction on
 * `/api/oauth/token`. On success the rotated tokens are persisted. On failure
 * (revoked/expired refresh token) the stored auth is cleared and `null` is
 * returned so the caller can drop back to the pairing screen.
 */
export async function ensureFreshAuth(auth: AuthState): Promise<AuthState | null> {
  if (Date.now() < auth.expiresAt - REFRESH_SKEW_MS) return auth;
  if (!auth.refreshToken) return auth; // nothing to refresh with; let it ride
  try {
    const r = await invoke<RefreshedAuth>('oauth_refresh', {
      apiBase: auth.apiBase,
      refreshToken: auth.refreshToken,
      clientId: CLIENT_ID,
    });
    const next: AuthState = {
      ...auth,
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? auth.refreshToken,
      expiresAt: Date.now() + r.expires_in * 1000,
    };
    await saveAuth(next);
    return next;
  } catch {
    await clearAuth();
    return null;
  }
}
