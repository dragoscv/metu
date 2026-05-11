'use client';
import { useState, useTransition } from 'react';
import { issueApiTokenAction } from '@/app/actions/api-tokens';

const SCOPES = [
  'capture:write',
  'recall:read',
  'notify:write',
  'tools:invoke',
  'creds:borrow',
  'presence:talk',
] as const;

export function IssueApiTokenForm() {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['capture:write', 'recall:read']);
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [pending, startTransition] = useTransition();
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setErr(null);
    startTransition(async () => {
      const r = await issueApiTokenAction({ name: name.trim(), scopes, expiresInDays });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setIssued({ token: r.token, expiresAt: r.expiresAt });
      setName('');
    });
  }

  if (issued) {
    return (
      <div className="grid gap-3">
        <div className="text-sm font-medium text-[var(--color-success,#10b981)]">
          Token issued — copy it now, this is the only time it will be shown.
        </div>
        <code className="block break-all rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 font-mono text-xs">
          {issued.token}
        </code>
        <div className="text-[11px] text-[var(--color-fg-subtle)]">
          Expires {new Date(issued.expiresAt).toLocaleString()}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(issued.token)}
            className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-xs text-white"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label className="grid gap-1 text-xs">
        <span className="text-[var(--color-fg-subtle)]">Token name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My laptop / CI / mobile script"
          maxLength={80}
          required
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-sm"
        />
      </label>
      <fieldset className="grid gap-1 text-xs">
        <legend className="text-[var(--color-fg-subtle)]">Scopes</legend>
        <div className="flex flex-wrap gap-2">
          {SCOPES.map((s) => (
            <label
              key={s}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1"
            >
              <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
              <span className="font-mono text-[11px]">{s}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="grid gap-1 text-xs">
        <span className="text-[var(--color-fg-subtle)]">Expires in</span>
        <select
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-sm"
        >
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
          <option value={365}>1 year</option>
        </select>
      </label>
      <div>
        <button
          type="submit"
          disabled={pending || !name.trim() || scopes.length === 0}
          className="rounded-md bg-[var(--color-brand)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Minting…' : 'Issue token'}
        </button>
      </div>
      {err && <div className="text-xs text-[var(--color-danger,#ef4444)]">{err}</div>}
    </form>
  );
}
