'use client';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
}

export interface SegmentedControlProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex items-center gap-0.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] font-medium transition-colors',
              size === 'sm' && 'px-2.5 py-1 text-xs',
              size === 'md' && 'px-3 py-1.5 text-sm',
              active
                ? 'text-[var(--color-fg)]'
                : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
            )}
          >
            {active ? (
              <motion.span
                layoutId="segmented-active"
                className="absolute inset-0 -z-10 rounded-[calc(var(--radius)-2px)] bg-[var(--color-bg-card)] shadow-sm"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            ) : null}
            <span>{opt.label}</span>
            {typeof opt.count === 'number' ? (
              <span className="text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
                {opt.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
