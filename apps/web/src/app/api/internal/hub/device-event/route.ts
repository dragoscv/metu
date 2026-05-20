/**
 * Internal hub → web bridge — receives `event.app` / `event.device`
 * envelopes from devices via the hub. The hub already persists the raw
 * row into `device_event`; this endpoint additionally:
 *   - mirrors the event into `timeline_event` (kind=`device.${kind}`) so
 *     the focus + Conductor + project surfaces can pick it up uniformly,
 *   - emits a `device/event` Inngest event for downstream reactors.
 *
 * Auth: shared `HUB_INTERNAL_SECRET` header `x-hub-secret`.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { inngest } from '@/inngest/client';
import { safeEqual } from '@/lib/safe-equal';
import { hubBroadcast } from '@/lib/hub';
import { randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

const schema = z.object({
  workspaceId: z.string().uuid(),
  deviceId: z.string().uuid(),
  kind: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.string().datetime().optional(),
});

function summarizeTitle(kind: string, payload: Record<string, unknown>): string {
  if (typeof payload.title === 'string' && payload.title.length > 0) {
    return String(payload.title).slice(0, 200);
  }
  if (typeof payload.summary === 'string' && payload.summary.length > 0) {
    return String(payload.summary).slice(0, 200);
  }
  return kind;
}

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

  const { workspaceId, deviceId, kind, payload, occurredAt } = parsed.data;
  const occurred = occurredAt ? new Date(occurredAt) : new Date();

  const db = getDb();
  const [row] = await db
    .insert(timelineEvent)
    .values({
      workspaceId,
      kind: `device.${kind}`,
      title: summarizeTitle(kind, payload),
      body: null,
      payload: { ...payload, deviceId },
      importance: 0.3,
      occurredAt: occurred,
    })
    .returning();

  // Cross-device awareness: relay this device.event to all OTHER devices in
  // the workspace so companion / mobile / browser-ext can surface "VS Code
  // active" / "Mobile recording" indicators. Best-effort — never block.
  void hubBroadcast({
    workspaceId,
    envelope: {
      type: 'event.timeline',
      id: row?.id ?? randomUUID(),
      kind: `device.${kind}`,
      title: summarizeTitle(kind, payload),
      payload: { ...payload, deviceId, sourceDeviceId: deviceId },
      occurredAt: occurred.toISOString(),
    },
  }).catch(() => {});

  // Best-effort fan-out for Conductor + reactor functions.
  try {
    await inngest.send({
      name: 'device/event',
      data: { workspaceId, deviceId, kind, payload },
    });
  } catch {
    // Don't fail the hub forward if Inngest is down — the timeline row is the source of truth.
  }

  return NextResponse.json({ ok: true });
}
