'use client';
/**
 * Settings card: send a self-test notification through the full fabric to
 * verify end-to-end delivery (in-app inbox + WS slider + web push + Expo
 * push). Reports back which channels actually fired.
 */
import { useState, useTransition } from 'react';
import { BellRing } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardTitle, Button } from '@metu/ui';
import { sendTestNotificationAction } from '@/app/actions/notifications';

export function TestNotificationCard() {
  const [pending, startTransition] = useTransition();
  const [last, setLast] = useState<{ delivered: string[]; subscriptions: number } | null>(null);

  function send() {
    startTransition(async () => {
      const r = await sendTestNotificationAction();
      if (!r.ok) {
        toast.error(`Could not send: ${r.error}`);
        return;
      }
      setLast({ delivered: r.delivered, subscriptions: r.subscriptions });
      if (r.subscriptions === 0) {
        toast.warning('Sent — no push subscriptions yet, check your inbox.');
      } else if (r.delivered.length === 0) {
        toast.warning('Sent — fabric ran but no channels confirmed delivery.');
      } else {
        toast.success(`Delivered via ${r.delivered.join(', ')}`);
      }
    });
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-4 w-4 text-[var(--color-brand)]" />
          Test notification
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={send} disabled={pending}>
          {pending ? 'Sending…' : 'Send test'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
        Fires a notification through the full fabric: in-app inbox, live WS slider, web push, and
        Expo push. Use this after pairing a new device.
      </p>
      {last ? (
        <p className="mt-3 text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Last run · {last.subscriptions} subscription{last.subscriptions === 1 ? '' : 's'} ·
          delivered: {last.delivered.length > 0 ? last.delivered.join(', ') : 'none'}
        </p>
      ) : null}
    </Card>
  );
}
