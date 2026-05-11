/**
 * Marketing layout — public, no auth required. The matcher in
 * apps/web/src/proxy.ts excludes /docs explicitly so this layout (and
 * any nested page) renders for anonymous visitors.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'metu — docs',
  description: 'Personal AI Operating System.',
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            metu
          </Link>
          <nav className="flex items-center gap-4 text-xs text-[var(--color-fg-subtle)]">
            <Link href="/docs">Docs</Link>
            <Link href="/docs/sdk">SDK</Link>
            <Link href="/docs/companion">Companion</Link>
            <Link href="/docs/security">Security</Link>
            <Link
              href="/sign-in"
              className="rounded-md bg-[var(--color-brand)] px-3 py-1 text-white"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>
    </div>
  );
}
