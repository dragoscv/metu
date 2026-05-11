'use client';

import { useTransition, useState } from 'react';
import { Button } from '@metu/ui';
import { Loader2, RefreshCw } from 'lucide-react';
import { replayDlqAction } from '@/app/actions/hub-dlq';
import { toast } from 'sonner';

export function ReplayDlqButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  if (done) return <span className="text-xs text-[var(--color-fg-subtle)]">Replayed</span>;

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await replayDlqAction({ ids: [id] });
          if (r.ok) {
            toast.success(`Replayed ${r.replayed}, failed ${r.failed}`);
            if (r.replayed > 0) setDone(true);
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
  );
}
