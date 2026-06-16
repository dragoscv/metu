'use client';
/**
 * BYO Discord bot wizard + manager.
 *
 * Step 1: create a Discord application + bot, paste token + application id +
 *         public key. We register slash commands + show the Interactions
 *         Endpoint URL to paste back into the Discord Developer Portal.
 * Step 2: in Discord, run /link <code> (code from the Telegram section's
 *         one-time code generator) to bind + lock your account.
 */
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import {
  connectDiscordBotAction,
  disconnectDiscordBotAction,
  getDiscordBotStatusAction,
  updateDiscordBotPrefsAction,
  type DiscordBotStatus,
} from '@/app/actions/discord-bot';

const TONES = [
  { id: 'chief_of_staff', label: 'Chief of staff (concise, warm)' },
  { id: 'minimal', label: 'Minimal (terse facts)' },
  { id: 'friendly', label: 'Friendly (conversational)' },
] as const;

export function DiscordBotPanel({
  initial,
  webhookBase,
}: {
  initial: DiscordBotStatus;
  webhookBase: string;
}) {
  const [status, setStatus] = useState<DiscordBotStatus>(initial);
  const [token, setToken] = useState('');
  const [appId, setAppId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [pending, start] = useTransition();

  const connect = () =>
    start(async () => {
      const r = await connectDiscordBotAction({ token, applicationId: appId, publicKey });
      if (r.ok) {
        toast.success(`Connected ${r.botUsername}`);
        setToken('');
        setStatus(await getDiscordBotStatusAction());
      } else {
        toast.error(r.error ?? 'Failed to connect');
      }
    });

  const disconnect = () =>
    start(async () => {
      await disconnectDiscordBotAction();
      toast.success('Disconnected');
      setStatus(await getDiscordBotStatusAction());
    });

  const savePrefs = (patch: Partial<DiscordBotStatus>) =>
    start(async () => {
      await updateDiscordBotPrefsAction({
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
            Open the{' '}
            <a className="underline" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">
              Discord Developer Portal
            </a>{' '}
            → New Application.
          </li>
          <li>Bot tab → Reset Token → copy the bot token.</li>
          <li>General Information → copy Application ID and Public Key.</li>
          <li>Paste all three below and Connect.</li>
        </ol>
        <Input type="password" placeholder="Bot token" value={token} onChange={(e) => setToken(e.target.value)} className="font-mono" />
        <Input placeholder="Application ID" value={appId} onChange={(e) => setAppId(e.target.value)} className="font-mono" />
        <Input placeholder="Public Key" value={publicKey} onChange={(e) => setPublicKey(e.target.value)} className="font-mono" />
        <Button onClick={connect} disabled={pending || !token || !appId || !publicKey}>
          {pending ? 'Connecting…' : 'Connect'}
        </Button>
        {appId && /^\d{15,25}$/.test(appId) && (
          <p className="text-xs text-[var(--color-fg-subtle)]">
            After connecting, set this as the <strong>Interactions Endpoint URL</strong> in
            the portal:
            <br />
            <code className="break-all">{webhookBase}/{appId}</code>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-4">
      <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <div>
          <div className="font-medium">
            {status.botUsername ?? 'bot'}{' '}
            {status.locked ? (
              <span className="text-xs text-[var(--color-success)]">● locked to you</span>
            ) : (
              <span className="text-xs text-[var(--color-warning)]">○ run /link &lt;code&gt; in Discord to bind</span>
            )}
          </div>
          {status.lastError && (
            <div className="text-xs text-[var(--color-danger)]">last error: {status.lastError}</div>
          )}
        </div>
        <Button variant="ghost" onClick={disconnect} disabled={pending}>
          Disconnect
        </Button>
      </div>

      <div className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>Proactive messages</span>
          <input type="checkbox" checked={status.outboundEnabled} onChange={(e) => savePrefs({ outboundEnabled: e.target.checked })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Tone</span>
          <select className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" value={status.tone} onChange={(e) => savePrefs({ tone: e.target.value })}>
            {TONES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Max per day</span>
          <input type="number" min={0} max={50} className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" value={status.dailyCap} onChange={(e) => savePrefs({ dailyCap: Number(e.target.value) })} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Min minutes between</span>
          <input type="number" min={0} max={1440} className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1" value={status.minGapMinutes} onChange={(e) => savePrefs({ minGapMinutes: Number(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}
