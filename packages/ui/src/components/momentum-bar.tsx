'use client';
import { motion } from 'framer-motion';
import { cn } from '../lib/cn';

interface MomentumBarProps {
  /** [0,1] */
  value: number;
  className?: string;
  label?: string;
}

export function MomentumBar({ value, className, label }: MomentumBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color =
    value >= 0.6
      ? 'var(--color-success)'
      : value >= 0.3
        ? 'var(--color-warning)'
        : 'var(--color-danger)';
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-[var(--color-fg-subtle)]">
          <span>{label}</span>
          <span>{Math.round(pct)}</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );
}
