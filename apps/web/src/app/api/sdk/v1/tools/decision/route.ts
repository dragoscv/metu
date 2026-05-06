/**
 * SDK v1 — POST /api/sdk/v1/tools/decision
 *
 * Bearer auth (`tools:invoke`). Lets a connected device (slider notification on
 * companion / mobile / browser-ext) approve or reject a pending tool call
 * without round-tripping through the web UI.
 *
 * Body: { toolCallId: string, decision: 'approve' | 'reject', reason?: string }
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { agent } from '@metu/core';
import { inngest } from '@/inngest/client';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';

export const runtime = 'nodejs';

const schema = z.object({
  toolCallId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'tools:invoke')) return forbidden();

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const { toolCallId, decision, reason } = parsed.data;
  if (decision === 'approve') {
    const r = await agent.approveToolCall(session.workspaceId, toolCallId, session.userId);
    await inngest.send({
      name: 'conductor/approved',
      data: { workspaceId: session.workspaceId, userId: session.userId, toolCallId },
    });
    return NextResponse.json({ ok: r.status === 'success', status: r.status, error: r.error });
  }

  await agent.rejectToolCall(session.workspaceId, toolCallId, reason);
  await inngest.send({
    name: 'conductor/rejected',
    data: { workspaceId: session.workspaceId, userId: session.userId, toolCallId, reason },
  });
  return NextResponse.json({ ok: true, status: 'rejected' });
}
