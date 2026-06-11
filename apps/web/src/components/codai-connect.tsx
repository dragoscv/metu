'use client';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import { connectCodai, disconnectCodai } from '@/app/actions/codai';

interface Props {
  connected: boolean;
}

export function CodaiConnect({ connected }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [pending, start] = useTransition();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    message?: string;
  } | null>(null);

  // Surface the OAuth callback result (set as ?codai_connected / ?codai_error)
  // then strip the query param so a refresh doesn't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get('codai_connected');
    const err = params.get('codai_error');
    if (!ok && !err) return;
    if (ok) toast.success('Codai connected.');
    if (err) toast.error(`Codai connect failed: ${err}`);
    params.delete('codai_connected');
    params.delete('codai_error');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);

  function save() {
    start(async () => {
      const r = await connectCodai({ apiKey });
      if (r.ok) {
        toast.success('Codai connected.');
        setApiKey('');
        window.location.reload();
      } else {
        toast.error(r.error ?? 'Failed');
      }
    });
  }

  function disconnect() {
    if (!window.confirm('Disconnect Codai from this workspace?')) return;
    start(async () => {
      const r = await disconnectCodai();
      if (r.ok) {
        toast.success('Disconnected.');
        window.location.reload();
      } else {
        toast.error(r.error ?? 'Failed');
      }
    });
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/byok/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'codai' }),
      });
      const j = (await res.json()) as { ok?: boolean; latencyMs?: number; message?: string };
      setTestResult({ ok: !!j.ok, latencyMs: j.latencyMs, message: j.message });
      if (j.ok) {
        toast.success(`Codai reachable${j.latencyMs ? ` · ${j.latencyMs} ms` : ''}`);
      } else {
        toast.error(`Codai test failed${j.message ? `: ${j.message}` : ''}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'request failed';
      setTestResult({ ok: false, message });
      toast.error(`Codai test failed: ${message}`);
    } finally {
      setTesting(false);
    }
  }

  if (connected) {
    return (
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Connected</p>
          <p className="truncate text-xs text-[var(--color-fg-subtle)]">
            ai.codai.ro · model <code>codai</code> · used for reasoning, agentic, fast, vision &
            embeddings
          </p>
          {testResult ? (
            <p
              className={`mt-1 text-xs ${
                testResult.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger,#ef4444)]'
              }`}
            >
              {testResult.ok
                ? `Reachable${testResult.latencyMs ? ` · ${testResult.latencyMs} ms` : ''}`
                : `Failed${testResult.message ? `: ${testResult.message}` : ''}`}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled={testing} onClick={testConnection}>
            {testing ? 'Testing…' : 'Test connection'}
          </Button>
          <Button variant="ghost" disabled={pending} onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3">
      <a
        href="/api/integrations/oauth/codai/start"
        className="inline-flex items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--color-fg)] px-4 py-2 text-sm font-medium text-[var(--color-bg)] transition hover:opacity-90"
      >
        Connect with Codai
      </a>
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        or paste a key
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>
      <Input
        type="password"
        autoComplete="new-password"
        placeholder="Codai API key"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={pending || !apiKey.trim()} onClick={save}>
          Connect Codai
        </Button>
        <a
          href="https://ai.codai.ro"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[var(--color-fg-subtle)] underline-offset-2 hover:underline"
        >
          Get a key
        </a>
      </div>
    </div>
  );
}
