import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { device, deviceEvent } from '@metu/db/schema';
import { Page, PageHeader } from '@metu/ui';
import { DevicesView, type DeviceRow, type DeviceEventRow } from '@/components/devices-view';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const wsId = session.user.workspaceId;
  const db = getDb();

  const rows = await db
    .select()
    .from(device)
    .where(and(eq(device.workspaceId, wsId), isNull(device.revokedAt)))
    .orderBy(desc(device.lastSeenAt));

  const selected = sp.id ?? rows[0]?.id ?? null;

  let events: DeviceEventRow[] = [];
  if (selected) {
    const eventRows = await db
      .select({
        id: deviceEvent.id,
        kind: deviceEvent.kind,
        payload: deviceEvent.payload,
        occurredAt: deviceEvent.occurredAt,
      })
      .from(deviceEvent)
      .where(eq(deviceEvent.deviceId, selected))
      .orderBy(desc(deviceEvent.occurredAt))
      .limit(50);
    events = eventRows.map((e) => ({
      id: e.id,
      kind: e.kind,
      payload: (e.payload ?? {}) as Record<string, unknown>,
      occurredAt: e.occurredAt.toISOString(),
    }));
  }

  const ui: DeviceRow[] = rows.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind,
    platform: d.platform,
    version: d.version,
    presence: d.presence,
    capabilities: (d.capabilities ?? []) as string[],
    activity: (d.activity ?? {}) as Record<string, unknown>,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <Page>
      <PageHeader
        title="Devices"
        description="Every endpoint that runs you. Click a device to send commands or view its activity."
      />
      <DevicesView devices={ui} selectedId={selected} events={events} />
    </Page>
  );
}
