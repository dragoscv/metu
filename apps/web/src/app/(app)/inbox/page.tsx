import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listRecentCaptures, listProjects } from '@metu/db/queries';
import { Card } from '@metu/ui';
import { formatDistanceToNow } from 'date-fns';
import { BrainDump } from '@/components/brain-dump';
import { ImportConversations } from '@/components/import-conversations';

export default async function InboxPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const [captures, projects] = await Promise.all([
    listRecentCaptures(session.user.workspaceId, 100),
    listProjects(session.user.workspaceId),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Brain dump</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Universal inbox. Type, paste, record. metu sorts later.
        </p>
      </header>

      <BrainDump />

      <ImportConversations projects={projects.map((p) => ({ id: p.id, name: p.name }))} />

      <Card>
        <ul className="divide-y divide-[var(--color-border)]">
          {captures.map((c) => {
            const meta = (c.metadata ?? {}) as {
              imported?: boolean;
              title?: string;
              format?: string;
              messageCount?: number;
            };
            const isImported = meta.imported === true;
            return (
              <li key={c.id} className="flex items-start gap-3 py-3">
                <span className="mt-1 inline-block rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
                  {isImported ? 'conversation' : c.kind}
                </span>
                <div className="min-w-0 flex-1">
                  {isImported && meta.title ? (
                    <p className="truncate text-sm font-medium">{meta.title}</p>
                  ) : null}
                  <p
                    className={
                      isImported ? 'line-clamp-2 text-xs text-[var(--color-fg-muted)]' : 'text-sm'
                    }
                  >
                    {c.content ?? (
                      <em className="text-[var(--color-fg-subtle)]">no transcript yet…</em>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(new Date(c.capturedAt), { addSuffix: true })} · via{' '}
                    {isImported
                      ? `${meta.format ?? 'import'}${meta.messageCount ? ` · ${meta.messageCount} msgs` : ''}`
                      : c.source}
                  </p>
                </div>
              </li>
            );
          })}
          {captures.length === 0 && (
            <li className="py-8 text-center text-sm text-[var(--color-fg-subtle)]">
              Nothing captured yet.
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
