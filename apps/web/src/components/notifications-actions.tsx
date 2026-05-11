'use client';

import { useTransition } from 'react';
import { Button } from '@metu/ui';
import { CheckCheck } from 'lucide-react';
import { ackAllNotificationsAction } from '@/app/actions/notifications';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function NotificationsActions({
  hasUnread,
  urgency,
  source,
}: {
  hasUnread: boolean;
  urgency?: 'low' | 'normal' | 'high' | 'critical';
  source?: 'conductor' | 'integration' | 'app';
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!hasUnread) return null;
  const filtered = !!urgency || !!source;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await ackAllNotificationsAction(filtered ? { urgency, source } : undefined);
          if (r.ok) {
            toast.success(
              filtered ? 'Filtered notifications marked read.' : 'All notifications marked read.',
            );
            router.refresh();
          } else {
            toast.error('Failed to mark as read.');
          }
        })
      }
    >
      <CheckCheck className="h-3.5 w-3.5" />
      <span className="ml-1.5">{filtered ? 'Mark filtered read' : 'Mark all read'}</span>
    </Button>
  );
}
