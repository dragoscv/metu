'use client';
/**
 * Client island for notai home — capture + recall + notify against the
 * metu SDK using the bearer token threaded down from the server. The
 * token is short-lived; on 401 the user re-signs-in.
 */
import { useState } from 'react';
import { createClient } from '@metu/sdk';

interface Item {
  id: string;
  content: string | null;
  capturedAt: string;
}

export function NotaiClient({ initial, accessToken }: { initial: Item[]; accessToken: string }) {
  const [items, setItems] = useState<Item[]>(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const metu = createClient({
    baseUrl:
      typeof window !== 'undefined' && window.location.hostname !== 'localhost'
        ? '' // same-origin in prod (notai deploys with a metu reverse-proxy)
        : 'http://localhost:24890',
    auth: { kind: 'token', accessToken },
  });

  async function onCapture(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await metu.capture({
        kind: 'text',
        content: text,
        source: 'notai',
        metadata: {},
      });
      setItems((prev) => [
        { id: crypto.randomUUID(), content: text, capturedAt: new Date().toISOString() },
        ...prev,
      ]);
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'capture failed');
    } finally {
      setBusy(false);
    }
  }

  async function onNotify() {
    setBusy(true);
    setErr(null);
    try {
      await metu.notify({
        title: 'Hello from notai',
        body: 'Round-trip via the metu fabric.',
        urgency: 'normal',
        source: 'notai',
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'notify failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: '2rem' }}>
      <form onSubmit={onCapture} style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Capture a note (flows into metu memory)"
          style={{
            flex: 1,
            padding: '0.7rem 0.9rem',
            borderRadius: 8,
            background: '#16161a',
            color: '#e7e7ea',
            border: '1px solid #2a2a32',
            fontSize: 14,
          }}
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          style={{
            padding: '0.7rem 1.1rem',
            borderRadius: 8,
            background: '#7c3aed',
            color: 'white',
            border: 'none',
            cursor: busy ? 'wait' : 'pointer',
            fontWeight: 600,
          }}
        >
          Capture
        </button>
        <button
          type="button"
          onClick={onNotify}
          disabled={busy}
          style={{
            padding: '0.7rem 1.1rem',
            borderRadius: 8,
            background: 'transparent',
            color: '#9b9ba1',
            border: '1px solid #2a2a32',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Notify
        </button>
      </form>
      {err ? <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{err}</p> : null}
      <h2 style={{ fontSize: 14, marginTop: '2rem', color: '#9b9ba1', textTransform: 'uppercase' }}>
        Recent (via metu.recall)
      </h2>
      <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
        {items.length === 0 ? (
          <li style={{ color: '#5a5a64', fontSize: 13 }}>No captures yet.</li>
        ) : (
          items.map((it) => (
            <li
              key={it.id}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 8,
                background: '#16161a',
                border: '1px solid #2a2a32',
                marginBottom: 8,
                fontSize: 14,
              }}
            >
              <p style={{ margin: 0 }}>{it.content ?? '—'}</p>
              <span style={{ color: '#5a5a64', fontSize: 11 }}>{it.capturedAt}</span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
