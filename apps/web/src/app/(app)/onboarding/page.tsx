/**
 * /onboarding — first-run wizard (web).
 *
 * Three steps driven by a `?step=` URL param so it's stateless +
 * deep-linkable + survives reload:
 *   1. connect — pick a BYOK provider (or Copilot OAuth)
 *   2. capture — write the first note via a Server Action
 *   3. done    — link out to /now and /settings
 *
 * Server-rendered. Server Actions + plain forms only — no client state.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardTitle, Page, PageHeader } from '@metu/ui';
import { listAvailableProviders } from '@metu/ai';
import { indexMemory } from '@metu/core/memory';

type Step = 'connect' | 'capture' | 'done';

async function captureFirstNoteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await auth();
  if (!session) throw new Error('unauthenticated');
  const content = String(formData.get('content') ?? '').trim();
  if (!content) throw new Error('empty');
  await indexMemory({
    workspaceId: session.user.workspaceId,
    sourceKind: 'capture',
    content,
    metadata: { source: 'onboarding' },
  });
  redirect('/onboarding?step=done');
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const step = (
    ['connect', 'capture', 'done'].includes(sp.step ?? '') ? sp.step : 'connect'
  ) as Step;

  const providers = await listAvailableProviders(session.user.workspaceId);
  const connectedProviders = providers.filter((p) => p.source === 'workspace');
  const hasProvider = connectedProviders.length > 0;

  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        title="Welcome to metu"
        description="Three quick steps. Skip anything you've already done."
      />

      <Stepper step={step} />

      {step === 'connect' && (
        <Card>
          <CardTitle>1 · Bring your own AI key</CardTitle>
          <p className="mt-2 text-sm text-[var(--color-fg-subtle)]">
            metu does not resell tokens. Add an OpenAI / Anthropic / Google key, or sign in with
            GitHub Copilot. Keys are sealed with AES-256-GCM per workspace.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <a
              href="/settings"
              className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
            >
              {hasProvider ? 'Manage providers' : 'Add a provider'}
            </a>
            <a
              href="/onboarding?step=capture"
              className="text-sm text-[var(--color-fg-subtle)] underline"
            >
              {hasProvider ? 'Continue →' : 'Skip for now'}
            </a>
          </div>
          {hasProvider ? (
            <p className="mt-3 text-xs text-[var(--color-success)]">
              ✓ {connectedProviders.length} provider
              {connectedProviders.length === 1 ? '' : 's'} connected.
            </p>
          ) : null}
        </Card>
      )}

      {step === 'capture' && (
        <Card>
          <CardTitle>2 · Capture your first note</CardTitle>
          <p className="mt-2 text-sm text-[var(--color-fg-subtle)]">
            Anything — a thought, a TODO, a quote. metu will index, embed, and recall it later.
          </p>
          <form action={captureFirstNoteAction} className="mt-4 grid gap-3">
            <textarea
              name="content"
              required
              minLength={1}
              maxLength={4000}
              rows={5}
              placeholder="What's on your mind right now?"
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
              >
                Capture
              </button>
              <a
                href="/onboarding?step=done"
                className="text-sm text-[var(--color-fg-subtle)] underline"
              >
                Skip
              </a>
            </div>
          </form>
        </Card>
      )}

      {step === 'done' && (
        <Card>
          <CardTitle>3 · You're set up</CardTitle>
          <p className="mt-2 text-sm text-[var(--color-fg-subtle)]">
            Open{' '}
            <a className="underline" href="/now">
              /now
            </a>{' '}
            for what's happening this minute, or{' '}
            <Link className="underline" href="/projects">
              /projects
            </Link>{' '}
            for the project list. The command bar (Cmd/Ctrl-K) handles capture, recall, and slash
            commands from anywhere.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href="/now"
              className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white"
            >
              Open /now
            </a>
            <a
              href="/settings/integrations/telegram"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-sm"
            >
              Connect Telegram
            </a>
            <a
              href="/docs"
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1.5 text-sm"
            >
              Read the docs
            </a>
          </div>
        </Card>
      )}
    </Page>
  );
}

function Stepper({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: 'connect', label: 'Connect AI' },
    { id: 'capture', label: 'First capture' },
    { id: 'done', label: 'Ready' },
  ];
  const idx = items.findIndex((x) => x.id === step);
  return (
    <ol className="mb-4 flex gap-2 text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
      {items.map((it, i) => (
        <li
          key={it.id}
          className={`rounded-full px-2 py-0.5 ${
            i <= idx
              ? 'bg-[var(--color-brand)] text-white'
              : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-subtle)]'
          }`}
        >
          {i + 1}. {it.label}
        </li>
      ))}
    </ol>
  );
}
