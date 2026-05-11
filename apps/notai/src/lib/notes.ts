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
  const res = await fetch(`${BASE}/api/sdk/v1/notai${path}`, {
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
  const j = await api<{ notes: NotaiNote[] }>('/notes', { method: 'GET', token });
  return j.notes;
}

export async function createNote(
  token: string,
  body: { title?: string; body?: string; folderId?: string | null },
): Promise<NotaiNote> {
  const j = await api<{ note: NotaiNote }>('/notes', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
  return j.note;
}

export async function updateNote(
  token: string,
  id: string,
  patch: { title?: string; body?: string; pinned?: boolean; folderId?: string | null },
): Promise<NotaiNote> {
  const j = await api<{ note: NotaiNote }>(`/notes?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(patch),
  });
  return j.note;
}

export async function deleteNote(token: string, id: string): Promise<void> {
  await api(`/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}

export interface NotaiFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listFolders(token: string): Promise<NotaiFolder[]> {
  const j = await api<{ folders: NotaiFolder[] }>('/folders', { method: 'GET', token });
  return j.folders;
}

export async function createFolder(
  token: string,
  body: { name: string; parentId?: string | null },
): Promise<NotaiFolder> {
  const j = await api<{ folder: NotaiFolder }>('/folders', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
  return j.folder;
}

export async function renameFolder(token: string, id: string, name: string): Promise<void> {
  await api('/folders', { method: 'PATCH', token, body: JSON.stringify({ id, name }) });
}

export async function deleteFolder(token: string, id: string): Promise<void> {
  await api(`/folders?id=${encodeURIComponent(id)}`, { method: 'DELETE', token });
}
