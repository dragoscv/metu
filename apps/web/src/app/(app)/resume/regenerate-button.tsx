'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { restoreContextAction } from '@/app/actions/continuity';

interface Props {
  projectId: string;
  hasBriefing: boolean;
}

export function RegenerateBriefingButton({ projectId, hasBriefing }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const result = await restoreContextAction(projectId);
      if (!result.ok) {
        toast.error(`Could not restore context: ${result.error}`);
        return;
      }
      toast.success('Briefing refreshed');
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={run}
      disabled={pending}
      aria-label={hasBriefing ? 'Regenerate briefing' : 'Generate briefing'}
    >
      {hasBriefing ? (
        <RefreshCcw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
      ) : (
        <Sparkles className={`h-3.5 w-3.5 ${pending ? 'animate-pulse' : ''}`} />
      )}
      {hasBriefing ? 'Regenerate' : 'Generate'}
    </Button>
  );
}
