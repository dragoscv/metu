'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { focus } from '@metu/core';
import { log } from '@/lib/logger';

export async function recomputeFocusAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const t0 = Date.now();
  log.info('focus.recompute.start', {
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
  });
  try {
    const result = await focus.computeFocus({
      workspaceId: session.user.workspaceId,
      userId: session.user.id,
    });
    log.info('focus.recompute.ok', {
      ms: Date.now() - t0,
      provider: result.provider,
      modelId: result.modelId,
      rowId: result.rowId,
    });
    revalidatePath('/dashboard');
    return { ok: true as const, provider: result.provider, modelId: result.modelId };
  } catch (err) {
    const e = err as Error & {
      cause?: unknown;
      text?: string;
      response?: { body?: unknown };
    };
    log.error('focus.recompute.failed', {
      ms: Date.now() - t0,
      name: e?.name,
      message: e?.message,
      cause: e?.cause,
      text: e?.text?.slice?.(0, 2000),
      stack: e?.stack?.split('\n').slice(0, 6).join('\n'),
    });
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return { ok: false as const, error: msg };
  }
}
