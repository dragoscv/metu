/**
 * Root 404. Catches any path that doesn't match a route — including paths
 * outside the (app) group. Kept self-contained so it works pre-auth.
 */
import Link from 'next/link';
import { Compass, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg text-center">
        <p className="font-mono text-xs uppercase tracking-[0.32em] text-[var(--color-fg-subtle)]">
          404 · not found
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--color-fg)]">
          That path isn&apos;t on the map
        </h1>
        <p className="mt-3 text-sm text-[var(--color-fg-muted)]">
          Either the page moved, the link rotted, or your second brain is teasing you. Let&apos;s
          get you somewhere useful.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            <Compass className="h-4 w-4" /> Open Now
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3.5 py-2 text-sm text-[var(--color-fg)] transition hover:bg-[var(--color-bg-elevated)]"
          >
            <Home className="h-4 w-4" /> Home
          </Link>
        </div>
        <p className="mt-8 font-mono text-[10px] text-[var(--color-fg-subtle)]">
          ⌘K to search · g d Now · g u METU · g c Chat
        </p>
      </div>
    </div>
  );
}
