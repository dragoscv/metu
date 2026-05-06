'use server';
import { auth } from '@metu/auth';
import { memory } from '@metu/core';

export async function recallAction(query: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (!query.trim()) return { ok: true as const, hits: [] };
  try {
    const res = await memory.recall({
      workspaceId: session.user.workspaceId,
      query,
      limit: 12,
    });
    return { ok: true as const, hits: (res as { rows?: unknown[] }).rows ?? res };
  } catch (err) {
    return {
      ok: false as const,
      error: err instanceof Error ? err.message : 'Failed',
    };
  }
}
