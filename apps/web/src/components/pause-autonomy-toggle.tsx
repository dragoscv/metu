'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@metu/ui';
import { Loader2, Pause, Play } from 'lucide-react';
import { toast } from 'sonner';
import { updateAutonomyPolicyAction } from '@/app/actions/autonomy';

export function PauseAutonomyToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, start] = useTransition();
  const router = useRouter();

  function handle() {
    const next = !enabled;
    setEnabled(next);
    start(async () => {
      const r = await updateAutonomyPolicyAction({ enabled: next });
      if (r && 'ok' in r && r.ok) {
        toast.success(next ? 'Autonomy resumed' : 'Autonomy paused');
        router.refresh();
      } else {
        setEnabled(!next);
        toast.error('Failed to update');
      }
    });
  }

  return (
    <Button
      size="sm"
      variant={enabled ? 'ghost' : 'outline'}
      disabled={pending}
      onClick={handle}
      title={enabled ? 'Pause autonomous ticks' : 'Resume autonomous ticks'}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : enabled ? (
        <Pause className="h-3.5 w-3.5" />
      ) : (
        <Play className="h-3.5 w-3.5" />
      )}
      <span className="ml-1.5">{enabled ? 'Pause' : 'Resume'}</span>
    </Button>
  );
}
