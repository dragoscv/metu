'use client';
import { Button, EmptyState } from '@metu/ui';
import { format, formatDistanceToNow, isToday, isYesterday } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { parseAsString, useQueryStates } from 'nuqs';
import { useEffect, useState, useTransition } from 'react';
import { loadMoreTimelineAction, type TimelineRowDTO } from '@/app/actions/timeline';
import { kindMeta, resolveSourceLink } from './kind-meta';

const TONE_BG: Record<string, string> = {
  success: 'bg-[var(--color-success-bg)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-bg)] text-[var(--color-danger)]',
  info: 'bg-[var(--color-info-bg)] text-[var(--color-info)]',
  brand: 'bg-[var(--color-brand)]/10 text-[var(--color-brand)]',
  neutral: 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]',
};

interface Props {
  initialItems: TimelineRowDTO[];
  initialCursor: { occurredAt: string; id: string } | null;
}

export function TimelineList({ initialItems, initialCursor }: Props) {
  const [filters] = useQueryStates({
    kinds: parseAsString.withDefault(''),
    projectId: parseAsString.withDefault(''),
    since: parseAsString.withDefault(''),
    q: parseAsString.withDefault(''),
  });
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pending, start] = useTransition();

  // Reset when initial data changes (server re-render due to filter change)
  useEffect(() => {
    setItems(initialItems);
    setCursor(initialCursor);
  }, [initialItems, initialCursor]);

  const loadMore = () => {
    if (!cursor || pending) return;
    start(async () => {
      const res = await loadMoreTimelineAction({
        cursor,
        kinds: filters.kinds ? filters.kinds.split(',').filter(Boolean) : [],
        projectId: filters.projectId || null,
        since: filters.since || null,
        search: filters.q || null,
      });
      if (res.ok) {
        setItems((prev) => [...prev, ...res.items]);
        setCursor(res.nextCursor);
      }
    });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        title="No events match your filters"
        description="Try clearing filters or widening the date range."
      />
    );
  }

  // Group by day
  const groups = groupByDay(items);

  return (
    <div className="space-y-6">
      <AnimatePresence initial={false}>
        {groups.map((g) => (
          <motion.section
            key={g.key}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1"
          >
            <h2 className="bg-[var(--color-bg)]/85 sticky top-0 z-10 -mx-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg-muted)] backdrop-blur">
              {g.label}
              <span className="ml-2 text-[var(--color-fg-subtle)]">{g.items.length}</span>
            </h2>
            <ol className="space-y-1">
              {g.items.map((e) => (
                <TimelineRow key={e.id} event={e} />
              ))}
            </ol>
          </motion.section>
        ))}
      </AnimatePresence>

      {cursor && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={loadMore} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Load more
          </Button>
        </div>
      )}
      {!cursor && items.length > 20 && (
        <p className="pt-2 text-center text-xs text-[var(--color-fg-subtle)]">End of timeline.</p>
      )}
    </div>
  );
}

function TimelineRow({ event }: { event: TimelineRowDTO }) {
  const meta = kindMeta(event.kind);
  const Icon = meta.icon;
  const tone = TONE_BG[meta.tone] ?? TONE_BG.neutral;
  const sourceLink = resolveSourceLink(event.kind, event.payload, event.projectId);
  const time = new Date(event.occurredAt);

  return (
    <motion.li layout className="group">
      <Link
        href={`/timeline/${event.id}`}
        className="flex items-start gap-3 rounded-lg border border-transparent px-2 py-2 transition hover:border-[var(--color-border)] hover:bg-[var(--color-bg-card)]"
      >
        <span
          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${tone}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
            <span>{meta.label}</span>
            <span>·</span>
            <time dateTime={event.occurredAt} title={time.toLocaleString()}>
              {format(time, 'HH:mm')}
            </time>
            {event.importance > 0.7 && (
              <span className="bg-[var(--color-brand)]/15 rounded-sm px-1 text-[9px] font-semibold text-[var(--color-brand)]">
                IMPORTANT
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm">{event.title}</p>
          {event.body && (
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-fg-muted)]">{event.body}</p>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {sourceLink && (
            <span
              className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-[var(--color-fg-muted)]"
              title="Has source link"
            >
              <ExternalLink className="h-3 w-3" />
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-[var(--color-fg-subtle)]" />
        </div>
      </Link>
    </motion.li>
  );
}

interface DayGroup {
  key: string;
  label: string;
  items: TimelineRowDTO[];
}

function groupByDay(items: TimelineRowDTO[]): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const item of items) {
    const d = new Date(item.occurredAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let g = map.get(key);
    if (!g) {
      g = { key, label: dayLabel(d), items: [] };
      map.set(key, g);
    }
    g.items.push(item);
  }
  return Array.from(map.values());
}

function dayLabel(d: Date): string {
  if (isToday(d)) return `Today · ${format(d, 'EEE, MMM d')}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, 'EEE, MMM d')}`;
  const diff = Date.now() - d.getTime();
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    return `${formatDistanceToNow(d, { addSuffix: true })} · ${format(d, 'EEE, MMM d')}`;
  }
  return format(d, 'EEEE, MMM d, yyyy');
}
