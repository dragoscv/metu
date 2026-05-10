'use client';
import { useState } from 'react';
import { Button } from '@metu/ui';

const SCOPE_LABELS: Record<string, { title: string; desc: string }> = {
  openid: { title: 'Identity', desc: 'See your METU user id.' },
  profile: { title: 'Profile', desc: 'See your name and avatar.' },
  email: { title: 'Email', desc: 'See your email address.' },
  offline_access: {
    title: 'Stay connected',
    desc: 'Refresh access without you signing in again.',
  },
  'capture:write': {
    title: 'Save captures',
    desc: 'Send notes, links, audio and files into your second brain.',
  },
  'capture:read': {
    title: 'Read captures',
    desc: 'Read your captures.',
  },
  'recall:read': {
    title: 'Search memory',
    desc: 'Run hybrid search across everything in your second brain.',
  },
  'notify:write': {
    title: 'Send notifications',
    desc: 'Push notifications to your devices via METU.',
  },
  'event:write': {
    title: 'Stream events',
    desc: 'Tell the Conductor what is happening in this app.',
  },
  'event:read': {
    title: 'Receive events',
    desc: 'Subscribe to events from METU.',
  },
  'tools:invoke': {
    title: 'Use tools',
    desc: 'Trigger tool calls in your workspace (subject to your autonomy policy).',
  },
  'audit:read': {
    title: 'Read audit log',
    desc: 'See what tools the Conductor and connected apps have called, and how much they cost.',
  },
};

export function ConsentForm({
  app,
  grantedScopes,
  params,
}: {
  app: { name: string; iconUrl: string | null; type: string };
  grantedScopes: string[];
  params: Record<string, string>;
}) {
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-8">
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-6 shadow-lg">
        <div className="flex items-center gap-3">
          {app.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.iconUrl} alt="" className="h-10 w-10 rounded-md" />
          ) : (
            <div className="grid h-10 w-10 place-items-center rounded-md bg-[var(--color-bg-elevated)] font-semibold">
              {app.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-base font-medium">{app.name}</div>
            <div className="text-xs text-[var(--color-fg-subtle)]">
              {app.type === 'first_party'
                ? 'First-party app'
                : app.type === 'public'
                  ? 'Public client (PKCE)'
                  : 'Third-party app'}
            </div>
          </div>
        </div>

        <h1 className="mt-5 text-lg font-semibold tracking-tight">Connect to METU</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {app.name} is asking permission to:
        </p>

        <ul className="mt-3 space-y-2.5">
          {grantedScopes.map((scope) => {
            const meta = SCOPE_LABELS[scope] ?? {
              title: scope,
              desc: 'Custom scope.',
            };
            return (
              <li key={scope} className="flex gap-3 text-sm">
                <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]" />
                <div>
                  <div className="font-medium">{meta.title}</div>
                  <div className="text-xs text-[var(--color-fg-subtle)]">{meta.desc}</div>
                </div>
              </li>
            );
          })}
        </ul>

        <form
          method="POST"
          action="/api/oauth/authorize/decide"
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            const target = (e.nativeEvent as SubmitEvent).submitter as
              | HTMLButtonElement
              | undefined;
            setBusy(target?.value === 'allow' ? 'allow' : 'deny');
          }}
        >
          <input type="hidden" name="params" value={JSON.stringify(params)} />
          <input type="hidden" name="granted_scopes" value={grantedScopes.join(' ')} />
          <Button
            type="submit"
            name="decision"
            value="deny"
            variant="ghost"
            disabled={busy !== null}
            className="flex-1"
          >
            {busy === 'deny' ? 'Cancelling…' : 'Cancel'}
          </Button>
          <Button
            type="submit"
            name="decision"
            value="allow"
            disabled={busy !== null}
            className="flex-1"
          >
            {busy === 'allow' ? 'Connecting…' : 'Connect'}
          </Button>
        </form>

        <p className="mt-4 text-[11px] text-[var(--color-fg-subtle)]">
          You can revoke this connection any time in <strong>Apps</strong>.
        </p>
      </div>
    </main>
  );
}
