'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';
import { cn } from '../lib/cn';

/**
 * Themed surface. `data-card` lets theme stylesheets apply blur/saturation
 * automatically on the Glass theme without leaking into other themes.
 */
const cardVariants = cva('rounded-[var(--radius-lg)] border p-5', {
  variants: {
    variant: {
      default: 'border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-[var(--shadow-sm)]',
      glass:
        'border-[var(--color-border)] bg-[color:color-mix(in_oklch,var(--color-bg-card)_72%,transparent)] shadow-[var(--shadow-md)] backdrop-blur-xl backdrop-saturate-150',
      elevated: 'border-transparent bg-[var(--color-bg-overlay)] shadow-[var(--shadow-md)]',
      outline: 'border-[var(--color-border)] bg-transparent',
    },
    interactive: {
      true: 'transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-overlay)]',
      false: '',
    },
  },
  defaultVariants: { variant: 'default', interactive: false },
});

export interface CardProps extends HTMLMotionProps<'div'>, VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, ...props }, ref) => (
    <motion.div
      ref={ref}
      data-card
      data-card-variant={variant ?? 'default'}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(cardVariants({ variant, interactive }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3
    className={cn('text-sm font-medium tracking-tight text-[var(--color-fg-muted)]', className)}
    {...props}
  />
);

export const CardValue = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('mt-2 text-2xl font-semibold text-[var(--color-fg)]', className)} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-[var(--color-fg-muted)]', className)} {...props} />
);
