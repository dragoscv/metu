import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { device } from '@metu/db/schema';
import { Card } from '@metu/ui';
import { formatDistanceToNow } from 'date-fns';

const PRESENCE_COLOR: Record<string, string> = {
  online: 'var(--color-success, #22c55e)',
  idle: 'var(--color-warning, #eab308)',
  offline: 'var(--color-fg-subtle)',
};

export default async function DevicesPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const db = getDb();
  const rows = await db
    .select()
    .from(device)
    .where(eq(device.workspaceId, session.user.workspaceId))
    .orderBy(desc(device.lastSeenAt));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            Every endpoint that runs you. Pair a new one with a code from the companion app or VS
            Code extension.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.length === 0 ? (
          <Card>
            <div className="px-1 py-8 text-center text-sm text-[var(--color-fg-muted)]">
              No devices yet. Install the companion app or pair this browser to start.
            </div>
          </Card>
        ) : (
          rows.map((d) => (
            <Card key={d.id}>
              <div className="flex items-start gap-3">
                <span
                  className="mt-1 h-2.5 w-2.5 rounded-full"
                  style={{ background: PRESENCE_COLOR[d.presence] }}
                  aria-label={d.presence}
                />
                <div className="flex-1">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-[var(--color-fg-subtle)]">
                    {d.kind} · {d.platform}
                    {d.version ? ` · v${d.version}` : ''}
                  </div>
                  <div className="mt-2 text-xs text-[var(--color-fg-muted)]">
                    {d.lastSeenAt
                      ? `last seen ${formatDistanceToNow(new Date(d.lastSeenAt), { addSuffix: true })}`
                      : 'never seen'}
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
