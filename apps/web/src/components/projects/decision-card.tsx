'use client';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { Lightbulb } from 'lucide-react';

export interface DecisionRowData {
  id: string;
  title: string;
  rationale: string;
  decidedAt: string | null;
}

export function DecisionCard({
  decision,
  href,
  index = 0,
}: {
  decision: DecisionRowData;
  href: string;
  index?: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
      layout
    >
      <Link
        href={href}
        className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 transition hover:border-[var(--color-brand)]"
      >
        <div className="flex items-start gap-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-fg-subtle)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{decision.title}</span>
              {decision.decidedAt && (
                <span className="shrink-0 text-[10px] text-[var(--color-fg-subtle)]">
                  {new Date(decision.decidedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
              {decision.rationale}
            </p>
          </div>
        </div>
      </Link>
    </motion.li>
  );
}
