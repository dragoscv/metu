import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@metu/auth';
import { Page, PageHeader, Card } from '@metu/ui';
import { ClaimInviteForm } from '@/components/claim-invite-form';

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Invitation claim landing.
 *
 * - Anonymous → bounce to sign-in with `callbackUrl` pointed back here.
 *   On return the user is signed in and the form below renders.
 * - Signed in → render a one-click "Join workspace" button. The actual
 *   claim runs in `claimInviteAction` which validates the token + email.
 */
export default async function InviteClaimPage({ params }: PageProps) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    const cb = encodeURIComponent(`/invite/${token}`);
    redirect(`/sign-in?callbackUrl=${cb}`);
  }

  return (
    <Page>
      <PageHeader
        title="You've been invited"
        description="Review the invite below and accept to join the workspace."
      />
      <Card className="mx-auto max-w-md">
        <p className="text-sm text-[var(--color-fg-muted)]">
          Signed in as{' '}
          <span className="font-medium text-[var(--color-fg)]">{session.user.email}</span>.
        </p>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          The invite must match this email — if it doesn't, sign out and use the email it was sent
          to.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <ClaimInviteForm token={token} />
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          >
            Cancel
          </Link>
        </div>
      </Card>
    </Page>
  );
}
