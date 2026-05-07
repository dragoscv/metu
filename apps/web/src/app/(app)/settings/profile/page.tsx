import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardDescription, CardTitle, Page, PageHeader } from '@metu/ui';

export const metadata = { title: 'Profile · metu' };

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const u = session.user;

  return (
    <Page>
      <PageHeader
        eyebrow={<span className="text-sm text-[var(--color-fg-muted)]">Account</span>}
        title="Profile"
      />

      <Card>
        <div className="flex items-center gap-4">
          {u.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={u.image}
              alt=""
              className="h-16 w-16 rounded-full border border-[var(--color-border)]"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-[var(--color-bg-card)] text-xl text-[var(--color-fg-muted)]">
              {(u.name ?? u.email ?? '?').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">{u.name ?? 'Unnamed'}</p>
            <p className="truncate text-sm text-[var(--color-fg-muted)]">{u.email}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Workspace</CardTitle>
        <CardDescription className="mt-2">
          You belong to workspace{' '}
          <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs">
            {u.workspaceId}
          </code>
          . User id{' '}
          <code className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-xs">
            {u.id}
          </code>
          .
        </CardDescription>
      </Card>

      <Card variant="outline">
        <CardTitle>Coming soon</CardTitle>
        <CardDescription className="mt-2">
          Display name + avatar editing, password / passkey management, and account deletion are on
          the roadmap. For now sign-in identity is mirrored from the OAuth provider.
        </CardDescription>
      </Card>
    </Page>
  );
}
