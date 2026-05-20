/**
 * NowTab — the legacy "single focus + next + momentum + blockers" view.
 *
 * Until Batch 1, this was the entire `/dashboard?tab=now` content.
 * Now lives at `/focus` and is also rendered inside the dashboard until
 * we fold the focus engine into the observatory itself (Batch 2 decision).
 */
import Link from 'next/link';
import { ArrowRight, AlertTriangle, Compass, EyeOff } from 'lucide-react';
import { Card, CardTitle, MomentumBar } from '@metu/ui';
import type { focus } from '@metu/core';

export interface NowTabProps {
  latestFocus: Awaited<ReturnType<typeof focus.getLatestFocus>>;
  nowTask: {
    id: string;
    title: string;
    body: string | null;
    projectId: string | null;
    kind: string;
  } | null;
  nextTasks: ({ id: string; title: string; kind: string } | undefined)[];
  ignoredProjects: { id: string; name: string }[];
  momentumProjects: {
    id: string;
    name: string;
    momentumScore: number | null;
    lastMeaningfulActivityAt: Date | null;
  }[];
  blocked: { id: string; title: string; blockedReason: string | null }[];
}

function formatRelative(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d;
  const days = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function NowTab({
  latestFocus,
  nowTask,
  nextTasks,
  ignoredProjects,
  momentumProjects,
  blocked,
}: NowTabProps) {
  return (
    <div className="space-y-8">
      <Card className="overflow-hidden !p-0">
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-5 py-3">
          <Compass className="h-4 w-4 text-[var(--color-brand)]" />
          <CardTitle className="!mt-0">Your single focus</CardTitle>
        </div>
        <div className="p-5">
          {nowTask ? (
            <>
              <h2 className="text-2xl font-semibold tracking-tight">{nowTask.title}</h2>
              {nowTask.body && (
                <p className="mt-2 text-sm text-[var(--color-fg-muted)]">{nowTask.body}</p>
              )}
              <Link
                href={`/projects/${nowTask.projectId}`}
                className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--color-brand)] hover:underline"
              >
                Continue <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          ) : (
            <p className="text-sm text-[var(--color-fg-muted)]">
              Press{' '}
              <kbd className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-xs">
                Recompute
              </kbd>{' '}
              to ask the Focus Engine for your single next move.
            </p>
          )}
          {latestFocus?.rationale && (
            <p className="mt-4 text-pretty text-xs text-[var(--color-fg-subtle)]">
              {latestFocus.rationale}
            </p>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Next (≤3)</CardTitle>
          <ul className="mt-3 space-y-2">
            {nextTasks.length === 0 && <li className="text-sm text-[var(--color-fg-subtle)]">—</li>}
            {nextTasks.map(
              (t) =>
                t && (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
                  >
                    <span className="truncate">{t.title}</span>
                    <span className="text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
                      {t.kind}
                    </span>
                  </li>
                ),
            )}
          </ul>
        </Card>

        <Card>
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-[var(--color-fg-muted)]" />
            <CardTitle>Ignore this week</CardTitle>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm">
            {ignoredProjects.length === 0 && <li className="text-[var(--color-fg-subtle)]">—</li>}
            {ignoredProjects.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-fg-subtle)]" />
                <span className="decoration-[var(--color-fg-subtle)]/40 text-[var(--color-fg-muted)] line-through">
                  {p.name}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle>Momentum</CardTitle>
        <div className="mt-4 space-y-3">
          {momentumProjects.map((p) => (
            <Link
              href={`/projects/${p.id}`}
              key={p.id}
              className="block rounded-md p-2 transition-colors hover:bg-[var(--color-bg-elevated)]"
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-[var(--color-fg-subtle)]">
                  {p.lastMeaningfulActivityAt
                    ? `last ${formatRelative(p.lastMeaningfulActivityAt)}`
                    : 'no activity'}
                </span>
              </div>
              <MomentumBar value={p.momentumScore ?? 0} />
            </Link>
          ))}
          {momentumProjects.length === 0 && (
            <p className="text-sm text-[var(--color-fg-subtle)]">
              No projects yet.{' '}
              <Link href="/projects" className="underline">
                Create one
              </Link>
              .
            </p>
          )}
        </div>
      </Card>

      {blocked.length > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
            <CardTitle>Blockers</CardTitle>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {blocked.map((t) => (
              <li key={t.id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="font-medium">{t.title}</div>
                {t.blockedReason && (
                  <div className="mt-1 text-xs text-[var(--color-fg-muted)]">{t.blockedReason}</div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
