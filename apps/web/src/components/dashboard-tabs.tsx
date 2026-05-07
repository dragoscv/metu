import Link from 'next/link';
import { cn } from '@metu/ui';

export interface DashboardTab {
  key: string;
  label: string;
  hint?: string;
}

export const DASHBOARD_TABS: DashboardTab[] = [
  { key: 'now', label: 'Now', hint: 'What matters this minute' },
  { key: 'inbox', label: 'Inbox', hint: 'Unsorted captures + drift' },
  { key: 'plan', label: 'Plan', hint: 'Today + this week' },
  { key: 'widgets', label: 'Widgets', hint: 'Goals, targets, momentum' },
];

export function DashboardTabs({
  active,
  basePath = '/dashboard',
}: {
  active: string;
  basePath?: string;
}) {
  return (
    <nav className="flex flex-wrap gap-1 border-b border-[var(--color-border)] pb-2">
      {DASHBOARD_TABS.map((t) => (
        <Link
          key={t.key}
          href={t.key === 'now' ? basePath : `${basePath}?tab=${t.key}`}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            active === t.key
              ? 'bg-[var(--color-bg-card)] text-[var(--color-fg)]'
              : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]',
          )}
          title={t.hint}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
