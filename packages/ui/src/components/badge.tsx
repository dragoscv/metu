'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * Themed status badge / chip. Use for state indicators (success/danger/etc.),
 * inline tags, and counters. Colors come from CSS vars so all themes (incl.
 * the light "soft" theme) get correct contrast automatically.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium tracking-tight',
  {
    variants: {
      variant: {
        success:
          'border-[var(--color-success-border)] bg-[var(--color-success-bg)] text-[var(--color-success)]',
        warning:
          'border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
        danger:
          'border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
        info: 'border-[var(--color-info-border)] bg-[var(--color-info-bg)] text-[var(--color-info)]',
        neutral:
          'border-[var(--color-neutral-border)] bg-[var(--color-neutral-bg)] text-[var(--color-fg-muted)]',
        brand:
          'border-[color:color-mix(in_oklch,var(--color-brand)_35%,transparent)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]',
        outline: 'border-[var(--color-border)] bg-transparent text-[var(--color-fg-muted)]',
      },
      size: {
        xs: 'h-5 px-1.5 text-[10px]',
        sm: 'h-6 px-2 text-xs',
        md: 'h-7 px-2.5 text-sm',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'sm' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, size }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
