import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { listCaptures, captureFacets } from '@metu/db/queries';
import { Page, PageHeader, Card, Badge, EmptyState } from '@metu/ui';
import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { KeyboardFocus } from '@/components/keyboard-focus';

const VALID_KINDS = ['text', 'voice', 'image', 'link', 'code', 'screenshot'] as const;

interface PageProps {
  searchParams: Promise<{
    kind?: string;
    q?: string;
    tag?: string;
    cursor?: string;
    source?: string;
  }>;
}

export default async function CapturesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const kind = (VALID_KINDS as readonly string[]).includes(sp.kind ?? '') ? sp.kind! : null;
  const search = sp.q?.trim() || null;
  const tag = sp.tag?.trim().toLowerCase() || null;
  const cursor = sp.cursor?.trim() || null;
  const source = sp.source?.trim() || null;

  const { rows, nextCursor, hasMore } = await listCaptures({
    workspaceId: session.user.workspaceId,
    kind,
    search,
    cursor,
    source,
    limit: 50,
  });
  const facets = await captureFacets(session.user.workspaceId);
  const sourceOptions = facets.sources
    .filter((s) => s.value && s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  // Tag filter is post-query because metadata.tags is JSONB and we don't
  // want to push another schema-aware filter into listCaptures yet.
  const filtered = tag
    ? rows.filter((r) => {
        const tags = (r.metadata as { tags?: unknown } | null)?.tags;
        return (
          Array.isArray(tags) && tags.some((t) => typeof t === 'string' && t.toLowerCase() === tag)
        );
      })
    : rows;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayCount = filtered.filter((r) => r.capturedAt >= startOfToday).length;

  const kindChips: { label: string; value: string | null }[] = [
    { label: 'All', value: null },
    ...VALID_KINDS.map((k) => ({ label: k, value: k })),
  ];

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5" />
            Captures
          </span>
        }
        title="Captures"
        description={`${filtered.length} ${filtered.length === 1 ? 'capture' : 'captures'}${todayCount > 0 ? ` · ${todayCount} today` : ''}${tag ? ` with #${tag}` : ''}${kind ? ` of kind ${kind}` : ''}${search ? ` matching “${search}”` : ''}`}
      />
      <form action="/captures" method="get" className="mb-3">
        {kind && <input type="hidden" name="kind" value={kind} />}
        {tag && <input type="hidden" name="tag" value={tag} />}
        <input
          id="captures-search"
          type="search"
          name="q"
          placeholder="Search captures…  (press / to focus)"
          defaultValue={search ?? ''}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-1.5 text-sm placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-brand)] focus:outline-none"
        />
      </form>
      <KeyboardFocus targetId="captures-search" />
      {sourceOptions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[var(--color-fg-subtle)]">Source:</span>
          {sourceOptions.map((s) => {
            const isActive = source === s.value;
            const params = new URLSearchParams();
            if (kind) params.set('kind', kind);
            if (tag) params.set('tag', tag);
            if (search) params.set('q', search);
            params.set('source', s.value);
            const href = `/captures?${params.toString()}`;
            return (
              <Link
                key={s.value}
                href={href}
                className={`rounded-full border px-2 py-0.5 transition-colors ${
                  isActive
                    ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                    : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]'
                }`}
              >
                {s.value} <span className="opacity-60">({s.count})</span>
              </Link>
            );
          })}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {kindChips.map((c) => {
          const isActive = c.value === kind;
          const href = c.value
            ? `/captures?kind=${c.value}${tag ? `&tag=${tag}` : ''}`
            : `/captures${tag ? `?tag=${tag}` : ''}`;
          return (
            <Link
              key={c.label}
              href={href}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isActive
                  ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]'
              }`}
            >
              {c.label}
            </Link>
          );
        })}
        {tag && (
          <Link
            href={kind ? `/captures?kind=${kind}` : '/captures'}
            className="bg-[var(--color-brand)]/10 rounded-full border border-[var(--color-brand)] px-2.5 py-1 text-xs text-[var(--color-brand)]"
            title="Clear tag filter"
          >
            #{tag} ✕
          </Link>
        )}
        {source && (
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (kind) params.set('kind', kind);
              if (tag) params.set('tag', tag);
              if (search) params.set('q', search);
              const qs = params.toString();
              return qs ? `/captures?${qs}` : '/captures';
            })()}
            className="bg-[var(--color-brand)]/10 rounded-full border border-[var(--color-brand)] px-2.5 py-1 text-xs text-[var(--color-brand)]"
            title="Clear source filter"
          >
            from:{source} ✕
          </Link>
        )}
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5" />}
          title="No captures"
          description="Drop a thought from any device — web inbox, mobile app, browser extension, or VS Code."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const tags = (r.metadata as { tags?: unknown } | null)?.tags;
            const tagList = Array.isArray(tags)
              ? tags.filter((t): t is string => typeof t === 'string').slice(0, 6)
              : [];
            return (
              <Card key={r.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{r.kind}</Badge>
                    {r.source ? (
                      <Link
                        href={`/captures?source=${encodeURIComponent(r.source)}${kind ? `&kind=${kind}` : ''}${tag ? `&tag=${tag}` : ''}`}
                        className="text-xs text-[var(--color-fg-subtle)] hover:text-[var(--color-brand)] hover:underline"
                        title={`Filter by source: ${r.source}`}
                      >
                        {r.source}
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--color-fg-subtle)]">unknown</span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-fg-subtle)]">
                    {formatDistanceToNow(r.capturedAt, { addSuffix: true })}
                  </span>
                </div>
                {r.content && <p className="line-clamp-3 text-sm">{r.content}</p>}
                {r.sourceUrl && (
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-xs text-[var(--color-brand)] hover:underline"
                    title={r.sourceUrl}
                  >
                    {(() => {
                      try {
                        return new URL(r.sourceUrl).hostname;
                      } catch {
                        return r.sourceUrl;
                      }
                    })()}
                  </a>
                )}
                {tagList.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tagList.map((t) => (
                      <Link
                        key={t}
                        href={`/captures?tag=${encodeURIComponent(t.toLowerCase())}${kind ? `&kind=${kind}` : ''}`}
                        className="rounded-full bg-[var(--color-bg-overlay)] px-2 py-0.5 text-[10px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
                      >
                        #{t}
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {hasMore && nextCursor && (
        <div className="mt-4 flex justify-center">
          <Link
            href={(() => {
              const params = new URLSearchParams();
              if (kind) params.set('kind', kind);
              if (tag) params.set('tag', tag);
              if (search) params.set('q', search);
              params.set('cursor', nextCursor);
              return `/captures?${params.toString()}`;
            })()}
            className="rounded-full border border-[var(--color-border)] px-4 py-1.5 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]"
          >
            Load more →
          </Link>
        </div>
      )}
    </Page>
  );
}
