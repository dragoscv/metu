import * as SecureStore from 'expo-secure-store';

const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://app.metu.ro';

export async function getToken() {
  return (await SecureStore.getItemAsync('metu.token')) ?? '';
}
export async function setToken(t: string) {
  await SecureStore.setItemAsync('metu.token', t);
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
