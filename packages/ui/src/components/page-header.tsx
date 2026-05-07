import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { BackLink } from './back-link';

export interface PageHeaderProps {
  /** Main page title. */
  title: ReactNode;
  /** Short description displayed beneath the title. */
  description?: ReactNode;
  /**
   * Render a smart back-link above the title. Pass a fallback href; the
   * BackLink will prefer history.back() when navigating from same-origin.
   */
  back?: { href: string; label?: string };
  /** Right-aligned actions (buttons, badges, links). */
  actions?: ReactNode;
  /** Inline eyebrow content above the title (e.g. badges, breadcrumb). */
  eyebrow?: ReactNode;
  /** Optional accent (color dot, avatar, icon) shown next to the title. */
  accent?: ReactNode;
  /** Tightens vertical rhythm for nested/edit pages. */
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * Standardized page header. Use on every top-level and detail page so that
 * spacing, back-navigation, and action placement are uniform across the app.
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
  eyebrow,
  accent,
  size = 'md',
  className,
}: PageHeaderProps) {
  const titleClass =
    size === 'sm'
      ? 'text-2xl font-semibold tracking-tight'
      : 'text-3xl font-semibold tracking-tight';
  return (
    <header className={cn('flex items-start justify-between gap-4', className)} data-page-header="">
      <div className="min-w-0 flex-1">
        {back ? <BackLink href={back.href} label={back.label} /> : null}
        {eyebrow ? (
          <div className={cn('flex flex-wrap items-center gap-2', back && 'mt-1')}>{eyebrow}</div>
        ) : null}
        <div className={cn('flex min-w-0 items-center gap-3', (back || eyebrow) && 'mt-1')}>
          {accent}
          <h1 className={cn('min-w-0 truncate', titleClass)}>{title}</h1>
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2" data-page-actions="">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
