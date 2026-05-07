import { cn } from '../lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-md bg-[var(--color-bg-elevated)]', className)}
      {...props}
    />
  );
}
