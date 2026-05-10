'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { claimInviteAction } from '@/app/actions/team';

export function ClaimInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  return (
    <Button
      type="button"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          const r = await claimInviteAction({ token });
          if (r.ok) {
            setDone(true);
            toast.success(`Joined ${r.workspaceName}`);
            // Brief pause so the toast lands before the redirect.
            setTimeout(() => router.replace('/'), 600);
          } else {
            toast.error(humanize(r.error));
          }
        })
      }
    >
      {pending ? 'Joining…' : done ? 'Joined' : 'Accept invite'}
    </Button>
  );
}

function humanize(code: string): string {
  switch (code) {
    case 'unauthenticated':
      return 'Sign in first.';
    case 'invalid':
      return "This invite link isn't valid.";
    case 'expired':
      return 'This invite has expired. Ask the workspace owner to resend.';
    case 'used':
      return 'This invite has already been used.';
    case 'revoked':
      return 'This invite was revoked by the workspace owner.';
    case 'email_mismatch':
      return 'Sign in with the email this invite was sent to.';
    default:
      return 'Could not accept invite.';
  }
}
