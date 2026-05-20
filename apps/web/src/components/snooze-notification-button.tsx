'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@metu/ui';
import { Loader2, Clock } from 'lucide-react';
import { snoozeNotificationAction } from '@/app/actions/notifications';

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: 'Tomorrow', minutes: 60 * 18 },
];

export function SnoozeNotificationButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function pick(minutes: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      const r = await snoozeNotificationAction(id, minutes);
      if (r.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="relative inline-block">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Snooze"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </Button>
      {open ? (
        <div
          className="absolute right-0 top-full z-10 mt-1 flex gap-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-1 shadow-lg"
          role="menu"
        >
          {PRESETS.map((p) => (
            <button
              key={p.minutes}
              type="button"
              className="rounded px-2 py-1 text-xs hover:bg-[var(--color-bg-subtle)]"
              onClick={(e) => pick(p.minutes, e)}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
