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
