'use client';
import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useSidebar } from './sidebar-provider';

/**
 * Slim mobile-only topbar. Appears below md breakpoint to give thumb access
 * to the off-canvas sidebar (no global header on desktop — sidebar carries
 * everything: logo, nav, notifications, account).
 */
export function MobileTopbar() {
  const { setMobileOpen } = useSidebar();
  return (
    <header className="bg-[var(--color-bg)]/85 sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-[var(--color-border)] px-3 backdrop-blur md:hidden">
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="grid h-9 w-9 place-items-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
      >
        <Menu className="h-4 w-4" />
      </button>
      <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--color-brand)] text-[10px] text-[var(--color-brand-fg)]">
          m
        </span>
        metu
      </Link>
    </header>
  );
}
