import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function KeyHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1 font-mono text-[10px] font-medium text-[var(--color-fg-muted)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
