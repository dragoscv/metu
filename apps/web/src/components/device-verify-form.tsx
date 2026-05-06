'use client';
import { useState, useTransition } from 'react';
import { Button } from '@metu/ui';
import { verifyDeviceCodeAction } from '@/app/actions/apps';

export function DeviceVerifyForm({ initialCode }: { initialCode: string }) {
  const [code, setCode] = useState(initialCode);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'allowed' } | { kind: 'denied' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  function submit(decision: 'allow' | 'deny') {
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const res = await verifyDeviceCodeAction({ userCode: code, decision });
      if (!res.ok) setStatus({ kind: 'error', message: res.error });
      else setStatus({ kind: res.decision === 'allowed' ? 'allowed' : 'denied' });
    });
  }

  if (status.kind === 'allowed') {
    return (
      <div className="text-sm">
        <p className="text-[var(--color-success,green)]">Device approved.</p>
        <p className="mt-1 text-[var(--color-fg-muted)]">
          You can close this tab — the device will finish signing in within a few seconds.
        </p>
      </div>
    );
  }
  if (status.kind === 'denied') {
    return <p className="text-sm">Device pairing denied.</p>;
  }

  return (
    <div className="space-y-4">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="ABCD-1234"
        autoFocus
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-center font-mono text-lg tracking-[0.2em]"
      />
      {status.kind === 'error' ? (
        <p className="text-sm text-[var(--color-danger)]">{status.message}</p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={pending || !code} onClick={() => submit('deny')}>
          Deny
        </Button>
        <Button disabled={pending || !code} onClick={() => submit('allow')}>
          {pending ? 'Working…' : 'Allow'}
        </Button>
      </div>
    </div>
  );
}
