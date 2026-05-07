'use client';
import { useEffect, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Link from 'next/link';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { Card, StatusDot } from '@metu/ui';
import { toast } from 'sonner';
import {
  ackAllNotificationsAction,
  ackNotificationAction,
  listRecentNotificationsAction,
} from '@/app/actions/notifications';
import { approveToolCallAction, rejectToolCallAction } from '@/app/actions/conductor';
import { useSidebar } from './sidebar/sidebar-provider';

interface ActionDef {
  id: string;
  label: string;
  kind: 'approve' | 'reject' | 'open' | 'custom';
}

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  source: string;
  actionUrl: string | null;
  actions: unknown;
  metadata: unknown;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

const URGENCY_STATE: Record<
  NotificationItem['urgency'],
  'neutral' | 'brand' | 'warning' | 'danger'
> = {
  low: 'neutral',
  normal: 'brand',
  high: 'warning',
  critical: 'danger',
};

export function NotificationsBell() {
  const { collapsed } = useSidebar();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const r = await listRecentNotificationsAction(20);
    if (r.ok) setItems(r.items as NotificationItem[]);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  function handleAction(n: NotificationItem, a: ActionDef) {
    const meta = (n.metadata ?? {}) as { toolCallId?: string };
    startTransition(async () => {
      try {
        if (a.kind === 'approve' && meta.toolCallId) {
          await approveToolCallAction(meta.toolCallId);
          toast.success('Approved');
        } else if (a.kind === 'reject' && meta.toolCallId) {
          await rejectToolCallAction(meta.toolCallId);
          toast.success('Rejected');
        }
        await ackNotificationAction(n.id);
        setItems((prev) => prev.filter((x) => x.id !== n.id));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed');
      }
    });
  }

  function dismiss(n: NotificationItem) {
    startTransition(async () => {
      await ackNotificationAction(n.id);
      setItems((prev) => prev.filter((x) => x.id !== n.id));
    });
  }

  function dismissAll() {
    startTransition(async () => {
      await ackAllNotificationsAction();
      setItems([]);
    });
  }

  const count = items.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={collapsed ? `Notifications${count > 0 ? ` (${count})` : ''}` : undefined}
        className="relative flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
      >
        <Bell className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="flex-1 truncate text-left">Notifications</span>}
        {count > 0 && (
          <span
            className={
              collapsed
                ? 'absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-brand)] px-1 text-[9px] font-medium text-[var(--color-brand-fg)]'
                : 'rounded-full bg-[var(--color-brand)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-fg)]'
            }
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-full z-50 mb-1 ml-2 w-96 max-w-[calc(100vw-1rem)]"
            >
              <Card className="!p-0 shadow-2xl">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                  <span className="text-sm font-semibold">Notifications</span>
                  {count > 0 && (
                    <button
                      type="button"
                      onClick={dismissAll}
                      disabled={pending}
                      className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                    >
                      <CheckCheck className="h-3 w-3" /> Dismiss all
                    </button>
                  )}
                </div>
                <ul className="max-h-96 overflow-y-auto">
                  {items.length === 0 && (
                    <li className="px-4 py-8 text-center text-xs text-[var(--color-fg-subtle)]">
                      You&apos;re all caught up.
                    </li>
                  )}
                  {items.map((n) => {
                    const actions = (n.actions ?? []) as ActionDef[];
                    return (
                      <li
                        key={n.id}
                        className="border-b border-[var(--color-border)] px-3 py-2.5 last:border-0"
                      >
                        <div className="flex items-start gap-2">
                          <StatusDot
                            state={URGENCY_STATE[n.urgency]}
                            size="xs"
                            pulse={n.urgency === 'critical'}
                            className="mt-1.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-[var(--color-fg)]">
                                {n.title}
                              </p>
                              <button
                                type="button"
                                onClick={() => dismiss(n)}
                                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
                                aria-label="Dismiss"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                            {n.body && (
                              <p className="mt-0.5 line-clamp-3 text-xs text-[var(--color-fg-muted)]">
                                {n.body}
                              </p>
                            )}
                            <p className="mt-1 text-[10px] text-[var(--color-fg-subtle)]">
                              {n.source} · {new Date(n.createdAt).toLocaleString()}
                            </p>
                            {(actions.length > 0 || n.actionUrl) && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {actions.map((a) => (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => handleAction(n, a)}
                                    disabled={pending}
                                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] disabled:opacity-50 ${
                                      a.kind === 'approve'
                                        ? 'border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success)] hover:opacity-90'
                                        : a.kind === 'reject'
                                          ? 'border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-danger)] hover:opacity-90'
                                          : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]'
                                    }`}
                                  >
                                    {a.kind === 'approve' && <Check className="h-3 w-3" />}
                                    {a.kind === 'reject' && <X className="h-3 w-3" />}
                                    {a.label}
                                  </button>
                                ))}
                                {n.actionUrl && (
                                  <Link
                                    href={n.actionUrl}
                                    onClick={() => {
                                      dismiss(n);
                                      setOpen(false);
                                    }}
                                    className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]"
                                  >
                                    Open
                                  </Link>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
