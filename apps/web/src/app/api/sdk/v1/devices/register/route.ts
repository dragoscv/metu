/**
 * SDK v1 — POST /api/sdk/v1/devices/register
 *
 * Bearer auth (`notify:read` scope — same as `/push/register` since the
 * primary use is binding a push subscription to a device row). Upserts a
 * `device` row keyed by (workspaceId, userId, fingerprint) and returns
 * the device id so the client can pair its push subscription via
 * `/api/sdk/v1/push/register`.
 *
 * Mirrors the upsert logic from `apps/hub/src/socket.ts` (the WS hello
 * path) so HTTP-only clients (mobile, browser-ext) get the same row
 * shape as WS clients (companion, vscode-ext).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { device } from '@metu/db/schema';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

const KINDS = [
  'web',
  'mobile',
  'vscode_ext',
  'browser_ext',
  'companion_desktop',
  'mcp_client',
  'external_app',
] as const;

const schema = z.object({
  kind: z.enum(KINDS),
  platform: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  fingerprint: z.string().min(8).max(200),
  version: z.string().max(40).optional(),
  capabilities: z.array(z.string().max(64)).max(50).default([]),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'notify:read')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  // Atomic upsert keyed on (workspaceId, userId, fingerprint).
  const [row] = await db
    .insert(device)
    .values({
      workspaceId: session.workspaceId,
      userId: session.userId,
      kind: parsed.data.kind,
      platform: parsed.data.platform,
      name: parsed.data.name,
      fingerprint: parsed.data.fingerprint,
      version: parsed.data.version ?? null,
      capabilities: parsed.data.capabilities,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [device.workspaceId, device.userId, device.fingerprint],
      set: {
        kind: parsed.data.kind,
        platform: parsed.data.platform,
        name: parsed.data.name,
        version: parsed.data.version ?? null,
        capabilities: parsed.data.capabilities,
        lastSeenAt: new Date(),
      },
    })
    .returning();
  if (!row) {
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 });
  }
  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'device.registered',
      payload: { deviceId: row.id, kind: parsed.data.kind, platform: parsed.data.platform },
    },
  });
  return NextResponse.json({ ok: true, deviceId: row.id });
}
