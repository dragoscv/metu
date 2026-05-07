/**
 * 404 inside the authenticated app shell. Triggered by `notFound()` calls or
 * by paths that match `(app)/` route group but have no matching page.
 */
import Link from 'next/link';
import { Compass, Home, Sparkles } from 'lucide-react';
import { Page, PageHeader } from '@metu/ui';

export default function AppNotFound() {
  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-[var(--color-fg-subtle)]">
            404
          </span>
        }
        title="Nothing lives here"
        description="The page you tried to open doesn't exist (or it isn't yours to see)."
      />
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Compass className="h-4 w-4" /> Open Now
        </Link>
        <Link
          href="/metu"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3.5 py-2 text-sm text-[var(--color-fg)] transition hover:bg-[var(--color-bg-elevated)]"
        >
          <Sparkles className="h-4 w-4" /> METU dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3.5 py-2 text-sm text-[var(--color-fg)] transition hover:bg-[var(--color-bg-elevated)]"
        >
          <Home className="h-4 w-4" /> Home
        </Link>
      </div>
    </Page>
  );
}
