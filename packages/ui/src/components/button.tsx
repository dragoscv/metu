'use client';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef } from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-[var(--color-brand)] text-[var(--color-brand-fg)] hover:opacity-90',
        ghost: 'bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)]',
        outline:
          'border border-[var(--color-border)] bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-bg-elevated)]',
        subtle:
          'bg-[var(--color-bg-elevated)] text-[var(--color-fg)] hover:bg-[var(--color-bg-card)]',
        danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<'button'>, 'children'>, VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...props }, ref) => (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </motion.button>
  ),
);
Button.displayName = 'Button';
