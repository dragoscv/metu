import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listTimeline } from '@metu/db/queries';
import { Card } from '@metu/ui';
import { formatDistanceToNow } from 'date-fns';

export default async function TimelinePage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const events = await listTimeline(session.user.workspaceId, 100);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Timeline</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Episodic memory. Every meaningful event, in order.
        </p>
      </header>

      <Card>
        <ol className="relative ml-3 border-l border-[var(--color-border)]">
          {events.map((e) => (
            <li key={e.id} className="ml-4 py-2.5">
              <span
                className="absolute -left-[5px] mt-2 h-2 w-2 rounded-full"
                style={{
                  background: e.importance > 0.7 ? 'var(--color-brand)' : 'var(--color-fg-subtle)',
                }}
              />
              <div className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                {e.kind} · {formatDistanceToNow(new Date(e.occurredAt), { addSuffix: true })}
              </div>
              <div className="mt-0.5 text-sm">{e.title}</div>
              {e.body && (
                <div className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{e.body}</div>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
