'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { device } from '@metu/db/schema';
import { and, eq } from 'drizzle-orm';
import { hubBroadcast } from '@/lib/hub';

export async function sendDeviceCommandAction(input: {
  deviceId: string;
  command: 'wake' | 'lock' | 'capture' | 'speak' | 'open_url' | 'ping';
  payload?: Record<string, unknown>;
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };

  const db = getDb();
  const [row] = await db
    .select({ id: device.id, kind: device.kind })
    .from(device)
    .where(and(eq(device.id, input.deviceId), eq(device.workspaceId, session.user.workspaceId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Device not found' };

  const result = await hubBroadcast({
    workspaceId: session.user.workspaceId,
    deviceIds: [row.id],
    envelope: {
      type: 'command',
      id: randomUUID(),
      command: input.command,
      payload: input.payload ?? {},
    },
  });

  revalidatePath('/devices');
  return { ok: true as const, delivered: result?.delivered ?? 0 };
}

export async function renameDeviceAction(input: { deviceId: string; name: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (!input.name.trim()) return { ok: false as const, error: 'Name required' };

  const db = getDb();
  const result = await db
    .update(device)
    .set({ name: input.name.trim() })
    .where(and(eq(device.id, input.deviceId), eq(device.workspaceId, session.user.workspaceId)));
  revalidatePath('/devices');
  return { ok: result ? (true as const) : (false as const) };
}

export async function unpairDeviceAction(input: { deviceId: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  await db
    .delete(device)
    .where(and(eq(device.id, input.deviceId), eq(device.workspaceId, session.user.workspaceId)));
  revalidatePath('/devices');
  return { ok: true as const };
}
