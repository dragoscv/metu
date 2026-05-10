'use client';
/**
 * Calendar feed card (6G) — owner/admin only. Lets the user create or
 * rotate the opaque token that produces a public iCalendar URL of goal
 * deadlines, suitable for Apple/Google/Outlook calendar subscriptions.
 */
import { useState, useTransition } from 'react';
import { Button, Card, CardTitle, CardDescription } from '@metu/ui';
import { toast } from 'sonner';
import {
  rotateCalendarFeedTokenAction,
  disableCalendarFeedAction,
} from '@/app/actions/calendar-feed';

export function CalendarFeedCard({
  initialToken,
  baseUrl,
  canManage,
}: {
  initialToken: string | null;
  baseUrl: string;
  canManage: boolean;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [isPending, startTransition] = useTransition();
  const url = token ? `${baseUrl}/api/calendar/goals/${token}` : null;

  function handleGenerate() {
    startTransition(async () => {
      const res = await rotateCalendarFeedTokenAction();
      if (res.ok) {
        setToken(res.token);
        toast.success(initialToken ? 'Feed rotated — old URL is now invalid' : 'Feed enabled');
      } else {
        toast.error(res.error === 'forbidden' ? 'Owner or admin required' : 'Not signed in');
      }
    });
  }

  function handleDisable() {
    if (!confirm('Disable the calendar feed? The current URL will stop working.')) return;
    startTransition(async () => {
      const res = await disableCalendarFeedAction();
      if (res.ok) {
        setToken(null);
        toast.success('Feed disabled');
      } else {
        toast.error(res.error === 'forbidden' ? 'Owner or admin required' : 'Not signed in');
      }
    });
  }

  function copyUrl() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(
      () => toast.success('Copied'),
      () => toast.error('Copy failed'),
    );
  }

  return (
    <Card className="mb-6 p-5">
      <CardTitle>Calendar feed</CardTitle>
      <CardDescription>
        Subscribe in Apple Calendar, Google Calendar, or Outlook to see goal deadlines alongside the
        rest of your week. The URL is the only credential — rotate it to revoke access.
      </CardDescription>

      {url ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 font-mono text-xs">
            <span className="truncate" title={url}>
              {url}
            </span>
            <button
              type="button"
              onClick={copyUrl}
              className="ml-auto shrink-0 text-[var(--color-fg-subtle)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline"
            >
              copy
            </button>
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleGenerate} disabled={isPending}>
                Rotate token
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDisable} disabled={isPending}>
                Disable feed
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4">
          {canManage ? (
            <Button onClick={handleGenerate} disabled={isPending}>
              {isPending ? 'Generating…' : 'Enable calendar feed'}
            </Button>
          ) : (
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Owner or admin role required to enable the feed.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
