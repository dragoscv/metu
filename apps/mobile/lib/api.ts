import * as SecureStore from 'expo-secure-store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://app.metu.ro';

export async function getToken() {
  return (await SecureStore.getItemAsync('metu.token')) ?? '';
}
export async function setToken(t: string) {
  await SecureStore.setItemAsync('metu.token', t);
}

/**
 * Stable per-install fingerprint. Generated lazily on first use and
 * persisted in SecureStore so device rows stay deduplicated across
 * relaunches. NOT a hardware id — wiping app data resets it.
 */
export async function getFingerprint(): Promise<string> {
  const existing = await SecureStore.getItemAsync('metu.fingerprint');
  if (existing) return existing;
  // expo's Crypto isn't a hard dep here — use a 128-bit hex string built
  // from Math.random pairs. Sufficient for uniqueness within a workspace.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const fp = `mobile-${hex}`;
  await SecureStore.setItemAsync('metu.fingerprint', fp);
  return fp;
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const r = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`metu ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
}
