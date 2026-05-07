'use client';
/**
 * Memory workspace UI — overview, quick capture, recall, recent feed.
 * One file because they share types, refresh callbacks, and animation state.
 */
import { useCallback, useMemo, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  Check,
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  CardValue,
  EmptyState,
  Input,
  PageSection,
  Textarea,
} from '@metu/ui';
import {
  type MemoryChunkRow,
  type MemoryOverview,
  type MemoryRecallHit,
  captureMemoryAction,
  deleteMemoryChunkAction,
  getMemoryOverviewAction,
  listRecentMemoriesAction,
  recallMemoryAction,
} from '@/app/actions/memory';
import { SOURCE_KIND_META, type SourceKind, formatRelative } from './source-kind';

const EASE = [0.22, 1, 0.36, 1] as const;

interface Props {
  initialOverview: MemoryOverview;
  initialRecent: MemoryChunkRow[];
  initialRecentCursor: string | null;
}

export function MemoryWorkspace({ initialOverview, initialRecent, initialRecentCursor }: Props) {
  const [overview, setOverview] = useState<MemoryOverview>(initialOverview);
  const [recent, setRecent] = useState<MemoryChunkRow[]>(initialRecent);
  const [recentCursor, setRecentCursor] = useState<string | null>(initialRecentCursor);
  const [recentFilter, setRecentFilter] = useState<SourceKind | 'all'>('all');
  const [recentLoading, setRecentLoading] = useState(false);

  const refreshOverview = useCallback(async () => {
    const r = await getMemoryOverviewAction();
    if (r.ok) setOverview(r.overview);
  }, []);

  const reloadRecent = useCallback(async (filter: SourceKind | 'all') => {
    setRecentLoading(true);
    const r = await listRecentMemoriesAction({
      sourceKind: filter === 'all' ? undefined : filter,
      limit: 20,
    });
    if (r.ok) {
      setRecent(r.items);
      setRecentCursor(r.nextCursor);
    }
    setRecentLoading(false);
  }, []);

  const loadMoreRecent = useCallback(async () => {
    if (!recentCursor) return;
    setRecentLoading(true);
    const r = await listRecentMemoriesAction({
      sourceKind: recentFilter === 'all' ? undefined : recentFilter,
      cursor: recentCursor,
      limit: 20,
    });
    if (r.ok) {
      setRecent((prev) => [...prev, ...r.items]);
      setRecentCursor(r.nextCursor);
    }
    setRecentLoading(false);
  }, [recentCursor, recentFilter]);

  const handleCapture = useCallback(async () => {
    await refreshOverview();
    await reloadRecent(recentFilter);
  }, [refreshOverview, reloadRecent, recentFilter]);

  const handleDelete = useCallback(
    async (id: string) => {
      // Optimistic remove
      setRecent((prev) => prev.filter((r) => r.id !== id));
      setOverview((prev) => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      const res = await deleteMemoryChunkAction({ id });
      if (!res.ok) {
        // Roll back by refreshing
        await reloadRecent(recentFilter);
        await refreshOverview();
      } else {
        await refreshOverview();
      }
    },
    [reloadRecent, refreshOverview, recentFilter],
  );

  const onFilterChange = (next: SourceKind | 'all') => {
    setRecentFilter(next);
    void reloadRecent(next);
  };

  return (
    <div className="space-y-8">
      <OverviewStats overview={overview} />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <RecallPanel />
        <QuickCapture onCaptured={handleCapture} />
      </div>

      <RecentPanel
        items={recent}
        cursor={recentCursor}
        loading={recentLoading}
        filter={recentFilter}
        kindCounts={overview.byKind}
        onFilterChange={onFilterChange}
        onLoadMore={loadMoreRecent}
        onDelete={handleDelete}
        onRefresh={() => void reloadRecent(recentFilter)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview stats
// ---------------------------------------------------------------------------

function OverviewStats({ overview }: { overview: MemoryOverview }) {
  const top3 = overview.byKind.slice(0, 3);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card variant="elevated">
        <CardTitle>Total memories</CardTitle>
        <CardValue>{overview.total.toLocaleString()}</CardValue>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          Embedded chunks across every source.
        </p>
      </Card>
      <Card variant="elevated">
        <CardTitle>Last indexed</CardTitle>
        <CardValue>
          {overview.lastIndexedAt ? formatRelative(overview.lastIndexedAt) : '—'}
        </CardValue>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          {overview.lastIndexedAt
            ? new Date(overview.lastIndexedAt).toLocaleString()
            : 'No memories yet.'}
        </p>
      </Card>
      <Card variant="elevated" className="sm:col-span-2">
        <CardTitle>Top sources</CardTitle>
        <div className="mt-3 flex flex-wrap gap-2">
          {top3.length === 0 ? (
            <span className="text-sm text-[var(--color-fg-subtle)]">Nothing yet.</span>
          ) : (
            top3.map((k) => {
              const meta = SOURCE_KIND_META[k.kind] ?? {
                label: k.kind,
                icon: Sparkles,
                tone: 'neutral' as const,
              };
              const Icon = meta.icon;
              return (
                <Badge key={k.kind} variant={meta.tone} size="md">
                  <Icon className="h-3.5 w-3.5" />
                  <span>{meta.label}</span>
                  <span className="ml-1 text-xs opacity-70">{k.count.toLocaleString()}</span>
                </Badge>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

function QuickCapture({ onCaptured }: { onCaptured: () => Promise<void> | void }) {
  const [content, setContent] = useState('');
  const [tag, setTag] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = content.trim().length >= 3 && !submitting;

  const submit = async () => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    const res = await captureMemoryAction({
      content,
      tag: tag.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setContent('');
    setTag('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 1800);
    void onCaptured();
  };

  return (
    <PageSection
      title="Capture a memory"
      description="Drop a thought, decision, or snippet — I'll embed it for later recall."
      icon={<Plus className="h-4 w-4" />}
    >
      <Card className="space-y-3">
        <Textarea
          placeholder="Today I decided to switch from Prisma to Drizzle because…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={5}
          disabled={submitting}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Optional tag (e.g. architecture, hiring)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={submitting}
            className="sm:max-w-[260px]"
          />
          <div className="flex flex-1 items-center justify-between gap-2 sm:justify-end">
            <span className="hidden text-xs text-[var(--color-fg-subtle)] sm:inline">
              ⌘ + Enter
            </span>
            <Button onClick={() => void submit()} disabled={!canSave}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Embedding…
                </>
              ) : success ? (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Saved
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Save to memory
                </>
              )}
            </Button>
          </div>
        </div>
        <AnimatePresence>
          {error ? (
            <motion.p
              key="err"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-sm text-[var(--color-danger)]"
            >
              {error}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </Card>
    </PageSection>
  );
}

// ---------------------------------------------------------------------------
// Recall (vector search)
// ---------------------------------------------------------------------------

function RecallPanel() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SourceKind | 'all'>('all');
  const [hits, setHits] = useState<MemoryRecallHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    start(async () => {
      setError(null);
      const r = await recallMemoryAction({
        query,
        sourceKind: filter === 'all' ? undefined : filter,
      });
      if (r.ok) {
        setHits(r.hits);
      } else {
        setError(r.error);
        setHits([]);
      }
    });
  };

  const reset = () => {
    setQuery('');
    setHits(null);
    setError(null);
  };

  return (
    <PageSection
      title="Recall"
      description="Semantic search across every embedded memory."
      icon={<Search className="h-4 w-4" />}
    >
      <Card className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="What were we doing about Stripe webhooks 2 weeks ago?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                run();
              }
            }}
            className="flex-1"
          />
          {query ? (
            <Button variant="ghost" onClick={reset} disabled={pending}>
              <X className="h-4 w-4" />
            </Button>
          ) : null}
          <Button onClick={run} disabled={pending || query.trim().length < 2}>
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">{pending ? 'Searching…' : 'Recall'}</span>
          </Button>
        </div>

        <KindFilterChips active={filter} onChange={setFilter} />

        <div className="min-h-[40px]">
          <AnimatePresence mode="popLayout" initial={false}>
            {pending ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-16 w-full animate-pulse rounded-md bg-[var(--color-bg-elevated)]"
                  />
                ))}
              </motion.div>
            ) : error ? (
              <motion.p
                key="err"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-[var(--color-danger)]"
              >
                {error}
              </motion.p>
            ) : hits === null ? null : hits.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <EmptyState
                  icon={<Sparkles />}
                  title="No matches"
                  description="Try different words, or relax the source filter."
                />
              </motion.div>
            ) : (
              <motion.ul
                key="hits"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.04 } },
                }}
                className="space-y-2"
              >
                {hits.map((h) => (
                  <RecallHitItem key={h.id} hit={h} />
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </PageSection>
  );
}

function RecallHitItem({ hit }: { hit: MemoryRecallHit }) {
  const [copied, setCopied] = useState(false);
  const meta = SOURCE_KIND_META[hit.sourceKind] ?? {
    label: hit.sourceKind,
    icon: Sparkles,
    tone: 'neutral' as const,
  };
  const Icon = meta.icon;
  const sim = Math.max(0, Math.min(1, hit.similarity));
  const pct = Math.round(sim * 100);
  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 6 },
        show: { opacity: 1, y: 0 },
      }}
      transition={{ duration: 0.22, ease: EASE }}
      className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3"
    >
      <div className="mb-1 flex items-center gap-2 text-xs">
        <Badge variant={meta.tone} size="xs">
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
        <span className="text-[var(--color-fg-subtle)]">{formatRelative(hit.createdAt)}</span>
        <div className="ml-auto flex items-center gap-2">
          <SimilarityBar value={sim} />
          <span className="tabular-nums text-[var(--color-fg-muted)]">{pct}%</span>
          <button
            type="button"
            aria-label="Copy"
            className="rounded p-1 text-[var(--color-fg-subtle)] transition-colors hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-fg)]"
            onClick={() => {
              navigator.clipboard?.writeText(hit.content).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm text-[var(--color-fg)]">{hit.content}</p>
    </motion.li>
  );
}

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-bg-card)] sm:block">
      <div
        className="h-full bg-[var(--color-brand)] transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent memories panel
// ---------------------------------------------------------------------------

function RecentPanel({
  items,
  cursor,
  loading,
  filter,
  kindCounts,
  onFilterChange,
  onLoadMore,
  onDelete,
  onRefresh,
}: {
  items: MemoryChunkRow[];
  cursor: string | null;
  loading: boolean;
  filter: SourceKind | 'all';
  kindCounts: { kind: SourceKind; count: number }[];
  onFilterChange: (k: SourceKind | 'all') => void;
  onLoadMore: () => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  onRefresh: () => void;
}) {
  return (
    <PageSection
      title="Recent memories"
      description="Most recent embedded chunks. Filter by source."
      actions={
        <Button variant="ghost" size="sm" onClick={onRefresh} aria-label="Refresh recent memories">
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
      }
    >
      <KindFilterChips active={filter} onChange={onFilterChange} counts={kindCounts} />

      <Card className="mt-3 space-y-2">
        {items.length === 0 && !loading ? (
          <EmptyState
            icon={<Sparkles />}
            title="Nothing here yet"
            description={
              filter === 'all'
                ? 'Capture a memory above or connect an integration to start filling this up.'
                : 'No memories with this source kind yet.'
            }
          />
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            <AnimatePresence initial={false}>
              {items.map((m) => (
                <RecentItem key={m.id} item={m} onDelete={onDelete} />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {cursor ? (
          <div className="pt-2">
            <Button
              variant="outline"
              onClick={() => void onLoadMore()}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowDown className="mr-2 h-4 w-4" />
              )}
              Load more
            </Button>
          </div>
        ) : null}
      </Card>
    </PageSection>
  );
}

function RecentItem({
  item,
  onDelete,
}: {
  item: MemoryChunkRow;
  onDelete: (id: string) => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = SOURCE_KIND_META[item.sourceKind] ?? {
    label: item.sourceKind,
    icon: Sparkles,
    tone: 'neutral' as const,
  };
  const Icon = meta.icon;
  const long = item.content.length > 280;
  const tag =
    typeof (item.metadata as { tag?: unknown })?.tag === 'string'
      ? ((item.metadata as { tag?: string }).tag as string)
      : null;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="group flex items-start gap-3 py-3">
        <Badge variant={meta.tone} size="xs" className="mt-0.5 shrink-0">
          <Icon className="h-3 w-3" />
          {meta.label}
        </Badge>
        <div className="min-w-0 flex-1">
          <p
            className={
              expanded
                ? 'whitespace-pre-wrap text-sm text-[var(--color-fg)]'
                : 'line-clamp-3 whitespace-pre-wrap text-sm text-[var(--color-fg)]'
            }
          >
            {item.content}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-fg-subtle)]">
            <span>{formatRelative(item.createdAt)}</span>
            {tag ? (
              <Badge variant="outline" size="xs">
                #{tag}
              </Badge>
            ) : null}
            {long ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label="Forget this memory"
          onClick={() => void onDelete(item.id)}
          className="shrink-0 rounded p-1 text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-danger)] focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.li>
  );
}

// ---------------------------------------------------------------------------
// Shared filter chips
// ---------------------------------------------------------------------------

function KindFilterChips({
  active,
  onChange,
  counts,
}: {
  active: SourceKind | 'all';
  onChange: (k: SourceKind | 'all') => void;
  counts?: { kind: SourceKind; count: number }[];
}) {
  // If counts provided, only show kinds that have data + 'all'.
  const allKinds = useMemo(() => {
    if (counts && counts.length > 0) {
      return counts.map((c) => c.kind);
    }
    return Object.keys(SOURCE_KIND_META) as SourceKind[];
  }, [counts]);

  const totalCount = counts?.reduce((acc, c) => acc + c.count, 0) ?? undefined;

  // Always keep the active filter visible even if its count is 0.
  const list: (SourceKind | 'all')[] = ['all', ...allKinds];

  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((k) => {
        const isActive = k === active;
        let label: string;
        let count: number | undefined;
        if (k === 'all') {
          label = 'All';
          count = totalCount;
        } else {
          label = SOURCE_KIND_META[k]?.label ?? k;
          count = counts?.find((c) => c.kind === k)?.count;
        }
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={[
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
              isActive
                ? 'bg-[var(--color-brand)]/15 border-[var(--color-brand)] text-[var(--color-fg)]'
                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]',
            ].join(' ')}
          >
            <span>{label}</span>
            {typeof count === 'number' ? (
              <span className="tabular-nums opacity-60">{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
