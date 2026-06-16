'use client';
/**
 * BYO Telegram bot wizard + manager.
 *
 * Step 1: paste a BotFather token → we validate + register the webhook.
 * Step 2: open your bot and send the link code (issued via TelegramLinkPanel)
 *         to bind your Telegram account (first sender becomes the only
 *         allowed user).
 * Once connected, tune proactive-message preferences.
 */
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import {
  connectTelegramBotAction,
  disconnectTelegramBotAction,
  getTelegramBotStatusAction,
  updateTelegramBotPrefsAction,
  type TelegramBotStatus,
} from '@/app/actions/telegram-bot';

const TONES = [
  { id: 'chief_of_staff', label: 'Chief of staff (concise, warm)' },
  { id: 'minimal', label: 'Minimal (terse facts)' },
  { id: 'friendly', label: 'Friendly (conversational)' },
] as const;

export function TelegramBotPanel({ initial }: { initial: TelegramBotStatus }) {
  const [status, setStatus] = useState<TelegramBotStatus>(initial);
  const [token, setToken] = useState('');
  const [pending, start] = useTransition();

  const refresh = () => start(async () => setStatus(await getTelegramBotStatusAction()));

  useEffect(() => {
    // Poll a couple times after connect so the "locked" badge updates once the
    // user sends /start in Telegram.
    if (!status.connected || status.locked) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [status.connected, status.locked]);

  const connect = () =>
    start(async () => {
      const r = await connectTelegramBotAction(token);
      if (r.ok) {
        toast.success(`Connected @${r.botUsername}`);
        setToken('');
        setStatus(await getTelegramBotStatusAction());
      } else {
        toast.error(r.error ?? 'Failed to connect');
      }
    });

  const disconnect = () =>
    start(async () => {
      await disconnectTelegramBotAction();
      toast.success('Disconnected');
      setStatus(await getTelegramBotStatusAction());
    });

  const savePrefs = (patch: Partial<TelegramBotStatus>) =>
    start(async () => {
      await updateTelegramBotPrefsAction({
        outboundEnabled: patch.outboundEnabled,
        tone: patch.tone as 'chief_of_staff' | 'minimal' | 'friendly' | undefined,
        dailyCap: patch.dailyCap,
        minGapMinutes: patch.minGapMinutes,
      });
      setStatus((s) => ({ ...s, ...patch }));
    });

  if (!status.connected) {
    return (
      <div className="mt-3 space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--color-fg-subtle)]">
          <li>
            Open{' '}
            <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noreferrer">
              @BotFather
            </a>{' '}
            in Telegram and send <code>/newbot</code>.
          </li>
          <li>Copy the HTTP API token it gives you.</li>
          <li>Paste it below — only you will be able to use the bot.</li>
        </ol>
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="123456789:ABCdef\u2026"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono"
          />
          <Button onClick={connect} disabled={pending || token.length < 20}>
            {pending ? 'Connecting\u2026' : 'Connect'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <div>
          <div className="font-medium">
            @{status.botUsername ?? 'bot'}{' '}
            {status.locked ? (
              <span className="text-xs text-[var(--color-success)]">\u25cf locked to you</span>
            ) : (
              <span className="text-xs text-[var(--color-warning)]">
                \u25cb send the link code in Telegram to bind your account
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--color-fg-subtle)]">
            {status.sentToday} proactive message(s) today
            {status.lastError ? ` \u00b7 last error: ${status.lastError}` : ''}
          </div>
        </div>
        <Button variant="ghost" onClick={disconnect} disabled={pending}>
          Disconnect
        </Button>
      </div>

      <div className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>Proactive messages</span>
          <input
            type="checkbox"
            checked={status.outboundEnabled}
            onChange={(e) => savePrefs({ outboundEnabled: e.target.checked })}
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span>Tone</span>
          <select
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            value={status.tone}
            onChange={(e) => savePrefs({ tone: e.target.value })}
          >
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3">
          <span>Max per day</span>
          <input
            type="number"
            min={0}
            max={50}
            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            value={status.dailyCap}
            onChange={(e) => savePrefs({ dailyCap: Number(e.target.value) })}
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <span>Min minutes between</span>
          <input
            type="number"
            min={0}
            max={1440}
            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
            value={status.minGapMinutes}
            onChange={(e) => savePrefs({ minGapMinutes: Number(e.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}
