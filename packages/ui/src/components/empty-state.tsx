import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  size = 'md',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'bg-[var(--color-bg-elevated)]/40 flex flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-[var(--color-border)] text-center',
        size === 'sm' && 'gap-2 px-6 py-8',
        size === 'md' && 'gap-3 px-8 py-12',
        size === 'lg' && 'gap-4 px-10 py-16',
        className,
      )}
    >
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bg-card)] text-[var(--color-fg-muted)]">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--color-fg)]">{title}</p>
        {description ? <p className="text-xs text-[var(--color-fg-muted)]">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
