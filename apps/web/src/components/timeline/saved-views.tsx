'use client';

/**
 * Saved-view chips for /timeline. Applying a view replaces the current
 * query string (nuqs keeps URL the source of truth). Saving captures
 * whatever filters are active right now.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bookmark, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteTimelineViewAction,
  listTimelineViewsAction,
  saveTimelineViewAction,
  type SavedView,
} from '@/app/actions/timeline-views';

const FILTER_KEYS = ['kinds', 'projectId', 'since', 'q', 'tag'] as const;

export function TimelineSavedViews() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    listTimelineViewsAction().then((res) => {
      if (res.ok) setViews(res.views);
    });
  }, []);

  const activeParams = (() => {
    const sp = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = searchParams.get(k);
      if (v) sp.set(k, v);
    }
    return sp.toString();
  })();

  function applyView(v: SavedView) {
    router.push(v.params ? `/timeline?${v.params}` : '/timeline');
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await saveTimelineViewAction({ name: trimmed, params: activeParams });
      if (res.ok) {
        setViews((v) => [...v, res.view]);
        setNaming(false);
        setName('');
        toast.success(`Saved view "${trimmed}"`);
      } else {
        toast.error(res.error);
      }
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteTimelineViewAction(id);
      if (res.ok) setViews((v) => v.filter((x) => x.id !== id));
      else toast.error(res.error ?? 'Delete failed');
    });
  }

  if (views.length === 0 && !activeParams && !naming) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {views.map((v) => {
        const isActive = v.params === activeParams;
        return (
          <span
            key={v.id}
            className={`group flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
              isActive
                ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                : 'border-[var(--color-border)] text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)]'
            }`}
          >
            <button type="button" onClick={() => applyView(v)} className="flex items-center gap-1">
              <Bookmark className="h-3 w-3" />
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete view ${v.name}`}
              onClick={() => remove(v.id)}
              className="opacity-0 transition group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}

      {activeParams ? (
        naming ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveCurrent();
                if (e.key === 'Escape') setNaming(false);
              }}
              placeholder="View name…"
              maxLength={60}
              className="h-7 rounded-full border border-[var(--color-border)] bg-transparent px-2.5 text-xs outline-none focus:border-[var(--color-brand)]"
            />
            <button
              type="button"
              onClick={saveCurrent}
              disabled={pending || !name.trim()}
              className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-fg-subtle)] transition hover:bg-[var(--color-bg-elevated)]"
          >
            <Plus className="h-3 w-3" />
            Save view
          </button>
        )
      ) : null}
    </div>
  );
}
