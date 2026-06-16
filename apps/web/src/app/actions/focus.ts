'use server';
import { auth } from '@metu/auth';
import { log } from '@/lib/logger';
import { inngest } from '@/inngest/client';

export async function recomputeFocusAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const t0 = Date.now();
  log.info('focus.recompute.start', {
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
  });
  try {
    // computeFocus is an LLM call that can exceed Vercel's 15s Server Action
    // budget (→ 504 "unexpected response"). Offload to Inngest so it runs in
    // the background; the dashboard/focus views reflect the new row on next
    // load (and via the hub focus broadcast). The send() is fail-fast wrapped.
    await inngest.send({
      name: 'focus/recompute',
      data: {
        workspaceId: session.user.workspaceId,
        userId: session.user.id,
        reason: 'manual',
      },
    });
    log.info('focus.recompute.queued', { ms: Date.now() - t0 });
    return { ok: true as const, queued: true as const };
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
