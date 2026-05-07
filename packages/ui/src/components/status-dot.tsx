'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../lib/cn';

/**
 * Single-color presence/status dot. Use next to text labels — pair with
 * `pulse` for live states (online, recording, streaming).
 */
const dotVariants = cva('inline-block shrink-0 rounded-full', {
  variants: {
    state: {
      success: 'bg-[var(--color-success)]',
      warning: 'bg-[var(--color-warning)]',
      danger: 'bg-[var(--color-danger)]',
      info: 'bg-[var(--color-info)]',
      brand: 'bg-[var(--color-brand)]',
      neutral: 'bg-[var(--color-fg-subtle)]',
      offline: 'bg-[var(--color-border-strong)]',
    },
    size: {
      xs: 'h-1.5 w-1.5',
      sm: 'h-2 w-2',
      md: 'h-2.5 w-2.5',
      lg: 'h-3 w-3',
    },
    pulse: {
      true: 'animate-pulse',
      false: '',
    },
  },
  defaultVariants: { state: 'neutral', size: 'sm', pulse: false },
});

export interface StatusDotProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof dotVariants> {}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, state, size, pulse, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden
      className={cn(dotVariants({ state, size, pulse }), className)}
      {...props}
    />
  ),
);
StatusDot.displayName = 'StatusDot';
