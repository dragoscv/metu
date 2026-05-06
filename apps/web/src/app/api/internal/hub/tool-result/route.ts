/**
 * Internal hub → web bridge — receives `tool.result` envelopes from devices
 * via the hub's WS pipe, persists them to `tool_call`, and emits a Conductor
 * tick so the supervisor can react to the result.
 *
 * Auth: shared `HUB_INTERNAL_SECRET` header `x-hub-secret`. Same pattern as
 * the hub's own `/internal/*` routes.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { toolCall } from '@metu/db/schema';
import { inngest } from '@/inngest/client';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';

const schema = z.object({
  workspaceId: z.string().uuid(),
  deviceId: z.string().uuid(),
  toolCallId: z.string().uuid(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

export async function POST(req: Request) {
  const secret = process.env.HUB_INTERNAL_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'unconfigured' }, { status: 500 });
  if (!safeEqual(req.headers.get('x-hub-secret'), secret))
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  await db
    .update(toolCall)
    .set({
      status: parsed.data.ok ? 'success' : 'failed',
      result: parsed.data.ok ? ((parsed.data.result ?? {}) as Record<string, unknown>) : null,
      error: parsed.data.ok ? null : (parsed.data.error ?? 'device error'),
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(toolCall.id, parsed.data.toolCallId),
        eq(toolCall.workspaceId, parsed.data.workspaceId),
      ),
    );

  // Wake the Conductor so it can reason about the result.
  await inngest.send({
    name: 'conductor/tick',
    data: { workspaceId: parsed.data.workspaceId, reason: 'tool.result' },
  });

  return NextResponse.json({ ok: true });
}
