/**
 * Direct fetch helpers for notai's notes endpoints. Stays a thin wrapper
 * because the SDK doesn't ship typed methods for notai-specific routes;
 * everything else uses the typed `metuClient`.
 */
const BASE =
  typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? ''
    : 'http://localhost:24890';

export interface NotaiNote {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

async function api<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const res = await fetch(`${BASE}/api/sdk/v1/notai/notes${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${init.token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(j?.error ?? `notai api ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listNotes(token: string): Promise<NotaiNote[]> {
  const j = await api<{ notes: NotaiNote[] }>('', { method: 'GET', token });
  return j.notes;
}

export async function createNote(
  token: string,
  body: { title?: string; body?: string },
): Promise<NotaiNote> {
  const j = await api<{ note: NotaiNote }>('', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
  return j.note;
}

export async function updateNote(
  token: string,
  id: string,
  patch: { title?: string; body?: string; pinned?: boolean },
): Promise<NotaiNote> {
  const j = await api<{ note: NotaiNote }>(`?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(patch),
  });
  return j.note;
}

export async function deleteNote(token: string, id: string): Promise<void> {
  await api(`?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}
