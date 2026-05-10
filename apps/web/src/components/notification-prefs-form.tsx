'use client';
import { useState, useTransition } from 'react';
import { Button, Card, CardTitle } from '@metu/ui';
import { toast } from 'sonner';
import {
  updateNotificationPrefsAction,
  type NotificationPrefs,
} from '@/app/actions/notification-prefs';

const CHANNELS: Array<{ id: 'ws' | 'web_push' | 'expo'; label: string; help: string }> = [
  { id: 'ws', label: 'In-app (live)', help: 'Toasts on web, HUD on companion, banner on mobile' },
  { id: 'web_push', label: 'Web push', help: 'Browser background notifications (VAPID)' },
  { id: 'expo', label: 'Mobile push', help: 'Native push to the Expo mobile app' },
];

const TZS = [
  'Europe/Bucharest',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

const inputCls =
  'w-full rounded-md bg-[var(--color-bg-elevated)] border border-[var(--color-border)] px-2 py-1 text-sm text-[var(--color-fg)]';

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs }) {
  const [state, setState] = useState<NotificationPrefs>(initial);
  const [pending, start] = useTransition();

  function toggleChannel(id: 'ws' | 'web_push' | 'expo') {
    setState((s) => ({
      ...s,
      mutedChannels: s.mutedChannels.includes(id)
        ? s.mutedChannels.filter((c) => c !== id)
        : [...s.mutedChannels, id],
    }));
  }

  function save() {
    start(async () => {
      const r = await updateNotificationPrefsAction({
        quietHours: state.quietHours,
        mutedChannels: state.mutedChannels,
      });
      if (r.ok) toast.success('Notification preferences saved');
      else toast.error(r.error);
    });
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardTitle>Channels</CardTitle>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          Mute a channel to stop delivery. Notifications are still recorded in the inbox so nothing
          is lost.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {CHANNELS.map((c) => {
            const muted = state.mutedChannels.includes(c.id);
            return (
              <label
                key={c.id}
                className="flex items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
              >
                <input type="checkbox" checked={!muted} onChange={() => toggleChannel(c.id)} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-xs text-[var(--color-fg-subtle)]">{c.help}</div>
                </div>
                <span className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                  {muted ? 'Muted' : 'On'}
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle>Quiet hours</CardTitle>
        <p className="text-sm text-[var(--color-fg-subtle)]">
          During quiet hours, low/normal-urgency push (web + mobile) is suppressed. High and
          critical alerts always go through.
        </p>
        <div className="mt-3 grid gap-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={state.quietHours.enabled}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  quietHours: { ...s.quietHours, enabled: e.target.checked },
                }))
              }
            />
            <span className="text-sm">Enable quiet hours</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <div className="text-xs text-[var(--color-fg-subtle)]">Start</div>
              <input
                type="time"
                className={inputCls}
                value={state.quietHours.start}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    quietHours: { ...s.quietHours, start: e.target.value },
                  }))
                }
              />
            </div>
            <div>
              <div className="text-xs text-[var(--color-fg-subtle)]">End</div>
              <input
                type="time"
                className={inputCls}
                value={state.quietHours.end}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    quietHours: { ...s.quietHours, end: e.target.value },
                  }))
                }
              />
            </div>
            <div>
              <div className="text-xs text-[var(--color-fg-subtle)]">Timezone</div>
              <select
                className={inputCls}
                value={state.quietHours.tz}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    quietHours: { ...s.quietHours, tz: e.target.value },
                  }))
                }
              >
                {TZS.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save preferences'}
        </Button>
      </div>
    </div>
  );
}
