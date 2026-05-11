'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@metu/ui';
import { Check, Loader2 } from 'lucide-react';
import { ackNotificationAction } from '@/app/actions/notifications';

export function DismissNotificationButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  if (done) return null;

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          const r = await ackNotificationAction(id);
          if (r.ok) {
            setDone(true);
            router.refresh();
          }
        });
      }}
      title="Mark as read"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
