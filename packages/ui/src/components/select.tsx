'use client';
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/cn';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full appearance-none rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] bg-[url("data:image/svg+xml;charset=UTF-8,%3csvg%20xmlns%3d%27http%3a//www.w3.org/2000/svg%27%20width%3d%2710%27%20height%3d%276%27%20viewBox%3d%270%200%2010%206%27%20fill%3d%27none%27%3e%3cpath%20d%3d%27M1%201l4%204%204-4%27%20stroke%3d%27%2399a%27%20stroke-width%3d%271.5%27%20stroke-linecap%3d%27round%27%20stroke-linejoin%3d%27round%27/%3e%3c/svg%3e")] bg-[length:10px_6px] bg-[right_0.65rem_center] bg-no-repeat px-3 py-1.5 pr-8 text-sm text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
