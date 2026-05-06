'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { startCopilotConnect, pollCopilotConnect, disconnectCopilot } from '@/app/actions/copilot';

interface CopilotUserSummary {
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  htmlUrl?: string;
}

interface Props {
  connected: boolean;
  user?: CopilotUserSummary | null;
}

interface Flow {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}

export function CopilotConnect({ connected, user }: Props) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => () => void (stoppedRef.current = true), []);

  async function start() {
    setBusy(true);
    setStatus(null);
    const r = await startCopilotConnect();
    if (!r.ok) {
      setBusy(false);
      toast.error(r.error);
      return;
    }
    setFlow({
      userCode: r.userCode,
      verificationUri: r.verificationUri,
      deviceCode: r.deviceCode,
      interval: r.interval,
    });
    setStatus('Open the page below and enter the code, then return here.');
    void poll(r.deviceCode, r.interval);
  }

  async function poll(deviceCode: string, intervalSec: number) {
    let interval = intervalSec;
    stoppedRef.current = false;
    while (!stoppedRef.current) {
      await new Promise((r) => setTimeout(r, interval * 1000));
      if (stoppedRef.current) return;
      const r = await pollCopilotConnect(deviceCode);
      if (!r.ok) {
        toast.error(r.error ?? 'Polling failed');
        setBusy(false);
        return;
      }
      if (r.status === 'ok') {
        toast.success('GitHub Copilot connected.');
        setFlow(null);
        setBusy(false);
        setStatus(null);
        // Reload to refresh provider list state.
        window.location.reload();
        return;
      }
      if (r.status === 'denied') {
        toast.error('Authorization denied.');
        setBusy(false);
        setFlow(null);
        return;
      }
      if (r.status === 'expired') {
        toast.error('Code expired. Try again.');
        setBusy(false);
        setFlow(null);
        return;
      }
      if (r.status === 'slow_down') interval += 5;
    }
  }

  async function disconnect() {
    const ok = window.confirm('Disconnect GitHub Copilot from this workspace?');
    if (!ok) return;
    const r = await disconnectCopilot();
    if (r.ok) {
      toast.success('Disconnected.');
      window.location.reload();
    } else {
      toast.error(r.error ?? 'Failed');
    }
  }

  if (connected) {
    return (
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
          <div className="flex min-w-0 items-center gap-3">
            {user?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.avatarUrl}
                alt={user.login}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full border border-[var(--color-border)]"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] text-sm font-medium">
                {user?.login?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">
                  {user?.name ?? user?.login ?? 'GitHub account'}
                </p>
                <span className="rounded-full bg-[var(--color-success-soft,rgba(34,197,94,0.15))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-success)]">
                  Connected
                </span>
              </div>
              {user?.login ? (
                <p className="truncate text-xs text-[var(--color-fg-subtle)]">
                  {user.htmlUrl ? (
                    <a
                      href={user.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      @{user.login}
                    </a>
                  ) : (
                    <>@{user.login}</>
                  )}
                  {user.email ? <> · {user.email}</> : null}
                </p>
              ) : null}
            </div>
          </div>
          <Button variant="outline" onClick={disconnect}>
            Disconnect
          </Button>
        </div>
        <p className="text-xs text-[var(--color-fg-muted)]">
          Models from your Copilot subscription are used wherever the routing policy or fallback
          chain selects <code>copilot</code>.
        </p>
      </div>
    );
  }

  if (flow) {
    return (
      <div className="mt-3 space-y-3">
        <p className="text-sm">
          1. Open{' '}
          <a href={flow.verificationUri} target="_blank" rel="noreferrer" className="underline">
            {flow.verificationUri}
          </a>{' '}
          and enter this code:
        </p>
        <code className="block rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-center font-mono text-2xl tracking-[0.3em]">
          {flow.userCode}
        </code>
        {status ? <p className="text-xs text-[var(--color-fg-subtle)]">{status}</p> : null}
        <p className="text-xs text-[var(--color-fg-subtle)]">Waiting for authorization…</p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-[var(--color-fg-muted)]">
        Use your GitHub Copilot subscription as the AI backend. We store only a sealed (AES-256-GCM)
        GitHub OAuth token; short-lived Copilot session tokens are minted on demand and cached in
        memory.
      </p>
      <Button disabled={busy} onClick={start}>
        {busy ? 'Starting…' : 'Connect GitHub Copilot'}
      </Button>
    </div>
  );
}
