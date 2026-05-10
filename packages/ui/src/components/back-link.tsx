'use client';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface BackLinkProps {
  /** Fallback target when there is no in-app history to pop. */
  href: string;
  label?: string;
  className?: string;
}

/**
 * Smart back link:
 * - If the user landed here from another page in this app (same origin), pops history.
 * - Otherwise navigates to the provided fallback `href`.
 * Renders as an <a> for keyboard/right-click affordances; intercepts on click.
 *
 * `href` is hardened to internal paths only — a `javascript:` URL would
 * otherwise execute on right-click "open in new tab" / middle-click,
 * bypassing the onClick interceptor. Anything that doesn't start with `/`
 * is rewritten to `/`.
 */
function sanitizeHref(href: string): string {
  if (typeof href !== 'string' || !href.startsWith('/')) return '/';
  // Reject protocol-relative URLs like `//evil.example.com`.
  if (href.startsWith('//')) return '/';
  return href;
}

export function BackLink({ href, label = 'Back', className }: BackLinkProps) {
  const safeHref = sanitizeHref(href);
  const router = useRouter();
  const [canPop, setCanPop] = useState(false);
  const startKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    startKeyRef.current = window.history.state?.key ?? null;
    // Treat as "can pop" only when there is in-app history we can return to.
    const sameOrigin =
      typeof document !== 'undefined' &&
      document.referrer.length > 0 &&
      new URL(document.referrer).origin === window.location.origin;
    setCanPop(window.history.length > 1 && sameOrigin);
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (canPop) router.back();
      else router.push(safeHref);
    },
    [canPop, safeHref, router],
  );

  return (
    <a
      href={safeHref}
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1 rounded text-xs text-[var(--color-fg-subtle)] transition-colors hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]',
        className,
      )}
    >
      <ChevronLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
      <span>{label}</span>
    </a>
  );
}
