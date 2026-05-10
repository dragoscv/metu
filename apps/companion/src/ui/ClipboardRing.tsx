/**
 * ClipboardRing — small panel that shows the most recent clipboard text
 * snippets (captured by `useClipboardRing`) and lets the user push any
 * one into metu as a capture.
 *
 * The capture POST goes through `@metu/sdk` so it inherits Zod validation
 * + the standard `/api/sdk/v1/capture` audit trail (timeline event +
 * conductor/observe event).
 */
import { useMemo, useState } from 'react';
import { createClient } from '@metu/sdk';
import type { AuthState } from '../state/auth';
import { useClipboardRing, type ClipboardEntry } from '../state/clipboard-ring';

function preview(text: string): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

function relTime(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

export function ClipboardRing({ auth }: { auth: AuthState }) {
  const { entries, clear, remove } = useClipboardRing(true);
  const [busyAt, setBusyAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = useMemo(
    () =>
      createClient({
        baseUrl: auth.apiBase,
        auth: { kind: 'token', accessToken: auth.accessToken },
      }),
    [auth.apiBase, auth.accessToken],
  );

  async function captureOne(entry: ClipboardEntry) {
    setBusyAt(entry.at);
    setError(null);
    try {
      await client.capture({
        kind: 'text',
        content: entry.text,
        source: 'companion-clipboard',
        metadata: { capturedAt: new Date(entry.at).toISOString() },
      });
      remove(entry.at);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'capture_failed');
    } finally {
      setBusyAt(null);
    }
  }

  if (entries.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Clipboard
        </p>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 11 }}>
          Copy text anywhere and it will appear here for one-tap capture.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Clipboard · {entries.length}
        </p>
        <button className="btn ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={clear}>
          Clear
        </button>
      </div>
      {error ? (
        <p
          className="muted"
          style={{ marginTop: 6, fontSize: 11, color: 'var(--danger, #f87171)' }}
        >
          {error}
        </p>
      ) : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 4 }}>
        {entries.slice(0, 8).map((e) => (
          <li
            key={e.at}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              padding: '4px 6px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.03)',
            }}
          >
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {preview(e.text)}
            </span>
            <span className="muted" style={{ fontSize: 10 }}>
              {relTime(e.at)}
            </span>
            <button
              className="btn"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => void captureOne(e)}
              disabled={busyAt === e.at}
            >
              {busyAt === e.at ? '…' : '→ metu'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
