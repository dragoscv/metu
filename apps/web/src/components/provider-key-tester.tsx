'use client';
/**
 * Tiny client island that pings each connected BYOK provider via
 * /api/byok/test and surfaces the result inline as a colored dot
 * with latency.
 *
 * Intentionally not exposed in the SDK — this is purely a settings-page
 * quality-of-life affordance.
 */
import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';

interface Result {
  state: 'idle' | 'pending' | 'ok' | 'fail';
  latencyMs?: number;
  message?: string;
}

const TESTABLE = new Set([
  'openai',
  'anthropic',
  'google',
  'deepgram',
  'elevenlabs',
  'ollama',
]);

export function ProviderKeyTester({ providers }: { providers: string[] }) {
  const [results, setResults] = useState<Record<string, Result>>({});

  async function test(provider: string) {
    setResults((r) => ({ ...r, [provider]: { state: 'pending' } }));
    try {
      const res = await fetch('/api/byok/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const j = (await res.json()) as { ok?: boolean; latencyMs?: number; message?: string };
      setResults((r) => ({
        ...r,
        [provider]: {
          state: j.ok ? 'ok' : 'fail',
          latencyMs: j.latencyMs,
          message: j.message,
        },
      }));
    } catch (e) {
      setResults((r) => ({
        ...r,
        [provider]: { state: 'fail', message: e instanceof Error ? e.message : 'request failed' },
      }));
    }
  }

  const testable = providers.filter((p) => TESTABLE.has(p));
  if (testable.length === 0) {
    return (
      <p className="text-xs text-[var(--color-fg-subtle)]">
        Connect a provider above to test it here.
      </p>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {testable.map((p) => {
        const r = results[p];
        return (
          <li
            key={p}
            className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
          >
            <div className="flex min-w-0 items-center gap-2">
              {r?.state === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
              ) : r?.state === 'fail' ? (
                <XCircle className="h-4 w-4 text-[var(--color-danger,#ef4444)]" />
              ) : r?.state === 'pending' ? (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--color-fg-subtle)]" />
              ) : (
                <Circle className="h-4 w-4 text-[var(--color-fg-subtle)]" />
              )}
              <span className="truncate text-sm font-medium">{p}</span>
              {r?.state === 'ok' && r.latencyMs !== undefined ? (
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  {r.latencyMs} ms
                </span>
              ) : null}
              {r?.state === 'fail' && r.message ? (
                <span className="truncate text-[10px] text-[var(--color-danger,#ef4444)]">
                  {r.message}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => test(p)}
              disabled={r?.state === 'pending'}
              className="rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)] disabled:opacity-50"
            >
              Test
            </button>
          </li>
        );
      })}
    </ul>
  );
}
