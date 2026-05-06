'use client';
import { useTransition } from 'react';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { recomputeFocusAction } from '@/app/actions/focus';

export function RecomputeFocusButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="subtle"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await recomputeFocusAction();
          if (res.ok) toast.success('Focus recomputed.');
          else toast.error(res.error ?? 'Failed');
        })
      }
    >
      <Sparkles className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      {pending ? 'Thinking…' : 'Recompute'}
    </Button>
  );
}
