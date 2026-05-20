'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@metu/ui';
import { Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { undoToolCallAction } from '@/app/actions/conductor';

export function ToolCallUndoButton({ toolCallId }: { toolCallId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const r = await undoToolCallAction(toolCallId);
          if (r.ok) {
            toast.success('Undone');
            router.refresh();
          } else {
            toast.error(r.error ?? 'Undo failed');
          }
        });
      }}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Undo2 className="h-3.5 w-3.5" />
      )}
      <span className="ml-1.5">Undo</span>
    </Button>
  );
}
