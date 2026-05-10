/**
 * SDK quick-start snippet — shown on the /apps page so devs registering
 * a new OAuth client immediately see how to consume metu from their app.
 *
 * Pure presentation; no client-side state.
 */
import Link from 'next/link';
import { Card, CardTitle } from '@metu/ui';

const SNIPPET = String.raw`import { createClient } from '@metu/sdk';

const metu = createClient({
  baseUrl: 'https://app.metu.ro',
  hubUrl: 'wss://hub.metu.ro',
  auth: { kind: 'token', accessToken: process.env.METU_ACCESS_TOKEN! },
});

// 1. Capture an event from your app
await metu.capture({
  kind: 'text',
  content: 'user opened the pricing page',
  source: { app: 'notai', surface: 'web' },
});

// 2. Notify the user across all their devices
await metu.notify({
  title: 'Quote ready for review',
  body: 'Tap to open the draft.',
  urgency: 'normal',
  actionUrl: 'https://notai.app/quotes/abc',
});

// 3. Recall context from metu's memory
const hits = await metu.recall({ query: 'pricing decision Q3' });

// 4. Borrow a credential (ACL-gated, audited)
const cred = await metu.borrow({
  integrationId: 'gh_main',
  purpose: 'open PR for triage',
  ttlSec: 300,
});

// 5. Subscribe to live events
const ws = await metu.connect({
  kind: 'external_app',
  platform: 'node',
  name: 'notai-server',
  fingerprint: 'notai-server-1',
});
ws.on('event.notification', (n) => console.log('[metu]', n.title));
`;

export function SdkQuickstart() {
  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <CardTitle>SDK quickstart</CardTitle>
        <Link href="/docs/sdk" className="text-xs text-[var(--color-fg-subtle)] hover:underline">
          Read the full reference →
        </Link>
      </div>
      <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
        Install <code className="rounded bg-[var(--color-bg-elevated)] px-1 py-0.5">@metu/sdk</code>{' '}
        in your app, register an OAuth client above, then drop in this code. All endpoints honour
        per-client scopes and emit{' '}
        <code className="rounded bg-[var(--color-bg-elevated)] px-1 py-0.5">conductor/observe</code>{' '}
        events the user can see in the timeline.
      </p>
      <pre className="mt-3 max-h-96 overflow-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
        <code>{SNIPPET}</code>
      </pre>
    </Card>
  );
}
