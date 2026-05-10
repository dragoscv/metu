/**
 * GitHub activity panel — renders the per-repo stats snapshot as a compact
 * stack of cards plus a 26-week commit heatmap. Lives on /projects/[id].
 *
 * All data comes from `listGithubRepoStatsForProject()` which joins
 * `github_repo_stats` to the project's repo links.
 */
import { Badge, Card } from '@metu/ui';
import {
  ArrowUpRight,
  Flame,
  GitCommit,
  GitMerge,
  GitPullRequest,
  ListChecks,
  Star,
} from 'lucide-react';
import Link from 'next/link';
import type { ProjectGithubStats } from '@metu/db/queries';
import { RefreshGithubStatsButton } from './refresh-github-stats-button';

const HEATMAP_WEEKS = 26;

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function languageEntries(bytes: Record<string, number>): Array<[string, number]> {
  const entries = Object.entries(bytes);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return [];
  return entries
    .map(([lang, n]) => [lang, n / total] as [string, number])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function CommitHeatmap({ histogram }: { histogram: number[] }) {
  // Show last N weeks (newest on the right).
  const tail = histogram.slice(-HEATMAP_WEEKS);
  const max = Math.max(1, ...tail);
  return (
    <div className="flex h-8 items-end gap-[2px]" aria-label="Weekly commit activity">
      {Array.from({ length: HEATMAP_WEEKS }).map((_, i) => {
        const v = tail[i] ?? 0;
        const h = Math.round((v / max) * 28) + 2;
        const intensity = v === 0 ? 0.15 : 0.35 + (v / max) * 0.6;
        return (
          <span
            key={i}
            title={`${v} commit${v === 1 ? '' : 's'}`}
            className="w-[6px] rounded-sm bg-[var(--color-brand)]"
            style={{ height: `${h}px`, opacity: intensity }}
          />
        );
      })}
    </div>
  );
}

export function GitHubActivityPanel({
  stats,
  projectId,
}: {
  stats: ProjectGithubStats[];
  projectId: string;
}) {
  if (stats.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-5">
        <p className="text-xs text-[var(--color-fg-subtle)]">
          No GitHub stats yet — link a repo or trigger a refresh.
        </p>
        <RefreshGithubStatsButton projectId={projectId} />
      </div>
    );
  }

  const totals = stats.reduce(
    (acc, s) => {
      acc.commits7d += s.commitsLast7d;
      acc.commits30d += s.commitsLast30d;
      acc.openPrs += s.openPullRequests;
      acc.openIssues += s.openIssues;
      acc.merged30d += s.mergedPrsLast30d;
      acc.closed30d += s.closedIssuesLast30d;
      acc.streak = Math.max(acc.streak, s.currentStreakDays);
      acc.stars += s.stargazers;
      return acc;
    },
    {
      commits7d: 0,
      commits30d: 0,
      openPrs: 0,
      openIssues: 0,
      merged30d: 0,
      closed30d: 0,
      streak: 0,
      stars: 0,
    },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <RefreshGithubStatsButton projectId={projectId} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryStat
          icon={<GitCommit className="h-4 w-4" />}
          label="Commits 7d"
          value={totals.commits7d}
          hint={`${totals.commits30d} in 30d`}
        />
        <SummaryStat
          icon={<GitPullRequest className="h-4 w-4" />}
          label="Open PRs"
          value={totals.openPrs}
          hint={`${totals.merged30d} merged 30d`}
        />
        <SummaryStat
          icon={<ListChecks className="h-4 w-4" />}
          label="Open issues"
          value={totals.openIssues}
          hint={`${totals.closed30d} closed 30d`}
        />
        <SummaryStat
          icon={<Flame className="h-4 w-4" />}
          label="Streak"
          value={totals.streak}
          hint={totals.streak === 1 ? 'day' : 'days'}
        />
      </div>

      {stats.map((s) => (
        <Card key={s.repoFullName} className="space-y-3">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Link
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold hover:underline"
              >
                {s.repoFullName}
              </Link>
              <Badge variant="neutral" size="xs">
                {s.defaultBranch ?? 'main'}
              </Badge>
              {s.primaryLanguage && (
                <Badge variant="neutral" size="xs">
                  {s.primaryLanguage}
                </Badge>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-fg-subtle)]">
                <Star className="h-3 w-3" />
                {s.stargazers}
              </span>
            </div>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              synced {formatRelative(s.lastSyncedAt)}
              {s.lastSyncError ? ` · error: ${s.lastSyncError}` : ''}
            </span>
          </header>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <RepoStat label="commits 7d" value={s.commitsLast7d} />
            <RepoStat label="commits 30d" value={s.commitsLast30d} />
            <RepoStat label="open PRs" value={s.openPullRequests} />
            <RepoStat label="merged 30d" value={s.mergedPrsLast30d} />
            <RepoStat label="open issues" value={s.openIssues} />
          </div>

          <div className="flex items-end justify-between gap-3">
            <CommitHeatmap histogram={s.weeklyCommitHistogram} />
            {languageEntries(s.languageBytes).length > 0 && (
              <div className="flex flex-1 flex-col items-end gap-1">
                <div className="flex h-1.5 w-full max-w-[280px] overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
                  {languageEntries(s.languageBytes).map(([lang, frac], i) => (
                    <span
                      key={lang}
                      title={`${lang} ${(frac * 100).toFixed(1)}%`}
                      className="h-full"
                      style={{
                        width: `${frac * 100}%`,
                        background: LANG_COLORS[i % LANG_COLORS.length],
                      }}
                    />
                  ))}
                </div>
                <span className="text-[10px] text-[var(--color-fg-subtle)]">
                  {languageEntries(s.languageBytes)
                    .map(([lang, frac]) => `${lang} ${(frac * 100).toFixed(0)}%`)
                    .join(' · ')}
                </span>
              </div>
            )}
          </div>

          {(s.recentMergedPrs.length > 0 || s.recentClosedIssues.length > 0) && (
            <div className="grid gap-3 md:grid-cols-2">
              {s.recentMergedPrs.length > 0 && (
                <ActivityList
                  title="Recently merged"
                  icon={<GitMerge className="h-3.5 w-3.5" />}
                  items={s.recentMergedPrs.slice(0, 3).map((p) => ({
                    title: `#${p.number} ${p.title}`,
                    url: p.url,
                    when: p.mergedAt,
                  }))}
                />
              )}
              {s.recentClosedIssues.length > 0 && (
                <ActivityList
                  title="Recently closed"
                  icon={<ListChecks className="h-3.5 w-3.5" />}
                  items={s.recentClosedIssues.slice(0, 3).map((i) => ({
                    title: `#${i.number} ${i.title}`,
                    url: i.url,
                    when: i.closedAt,
                  }))}
                />
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

const LANG_COLORS = ['#3178c6', '#f1e05a', '#e34c26', '#563d7c', '#dea584', '#41b883'];

function SummaryStat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-[var(--color-fg-subtle)]">{hint}</div>}
    </Card>
  );
}

function RepoStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[var(--color-bg-elevated)]/40 rounded-md px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function ActivityList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ title: string; url: string; when: string }>;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-fg-muted)]">
        {icon}
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs">
            <a
              href={it.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[var(--color-fg)] hover:underline"
            >
              <span className="line-clamp-1">{it.title}</span>
              <ArrowUpRight className="h-3 w-3 shrink-0 opacity-60" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
