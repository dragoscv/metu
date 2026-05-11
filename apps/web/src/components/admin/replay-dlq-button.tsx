'use client';

import { useTransition, useState } from 'react';
import { Button } from '@metu/ui';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { discardDlqAction, replayDlqAction } from '@/app/actions/hub-dlq';
import { toast } from 'sonner';

export function ReplayDlqButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<'replayed' | 'discarded' | null>(null);

  if (done) {
    return (
      <span className="text-xs text-[var(--color-fg-subtle)]">
        {done === 'replayed' ? 'Replayed' : 'Discarded'}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await replayDlqAction({ ids: [id] });
            if (r.ok) {
              toast.success(`Replayed ${r.replayed}, failed ${r.failed}`);
              if (r.replayed > 0) setDone('replayed');
            } else {
              toast.error(r.error);
            }
          })
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="h-3.5 w-3.5" />
        )}
        <span className="ml-1.5">Replay</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await discardDlqAction({ ids: [id] });
            if (r.ok) {
              toast.success('Discarded.');
              setDone('discarded');
            } else {
              toast.error(r.error);
            }
          })
        }
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}
