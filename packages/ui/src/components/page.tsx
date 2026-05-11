import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface PageProps {
  children: ReactNode;
  className?: string;
}

/**
 * Top-level page container. Provides consistent vertical rhythm. The outer
 * width/padding is owned by the app shell layout — `Page` only controls the
 * internal stack so headers, toolbars, and sections breathe uniformly.
 */
export function Page({ children, className }: PageProps) {
  return (
    <div
      className={cn('space-y-6', className)}
      data-page=""
      // Cross-page shared-element transitions: Next.js 16's `viewTransition`
      // prop on <Link> uses these names to morph between pages. Stable
      // names per slot keep the transition smooth.
      style={{ viewTransitionName: 'page' }}
    >
      {children}
    </div>
  );
}

export interface PageSectionProps {
  /** Section heading (h2). Omit for un-titled groupings. */
  title?: ReactNode;
  /** Inline content next to the title (badges, counts). */
  titleAdornment?: ReactNode;
  /** Right-aligned actions on the section header row. */
  actions?: ReactNode;
  /** Optional icon shown left of the title. */
  icon?: ReactNode;
  /** Description shown beneath the title. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function PageSection({
  title,
  titleAdornment,
  actions,
  icon,
  description,
  children,
  className,
  id,
}: PageSectionProps) {
  return (
    <section id={id} className={cn('space-y-3', className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                {icon ? <span className="text-[var(--color-fg-muted)]">{icon}</span> : null}
                <span className="truncate">{title}</span>
                {titleAdornment}
              </h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-xs text-[var(--color-fg-muted)]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
