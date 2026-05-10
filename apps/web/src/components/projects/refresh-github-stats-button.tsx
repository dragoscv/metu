'use client';

import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { kickGithubStatsSyncAction } from '@/app/actions/metu';

export function RefreshGithubStatsButton({ projectId }: { projectId?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await kickGithubStatsSyncAction(projectId ? { projectId } : undefined);
          if (r.ok) toast.success(`Refreshing ${r.queued} repo${r.queued === 1 ? '' : 's'}`);
          else toast.error(r.error);
        })
      }
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 text-xs hover:bg-[var(--color-bg-elevated)] disabled:opacity-60"
    >
      <RefreshCw className={`h-3 w-3 ${pending ? 'animate-spin' : ''}`} />
      Refresh stats
    </button>
  );
}
