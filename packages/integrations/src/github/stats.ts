/**
 * GitHub statistics collection.
 *
 * Pure REST helpers used by the `github-stats-sync` Inngest function. Keep
 * these idempotent and free of DB writes — the caller persists the result.
 *
 * Every function takes a `viewer` login (the GitHub user that owns the
 * workspace integration). Activity windows (`commitsLast7d`, etc.) are
 * always attributed to that viewer so the dashboard reflects "my work",
 * not arbitrary contributors.
 */

const API = 'https://api.github.com';

function ghHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

interface GhRepoMeta {
  full_name: string;
  default_branch: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  open_issues_count: number;
  pushed_at: string | null;
  topics?: string[];
  description?: string | null;
}

export interface RepoCommit {
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  url: string;
  authoredAt: string | null;
  additions?: number;
  deletions?: number;
}

export interface RepoMergedPr {
  number: number;
  title: string;
  url: string;
  mergedAt: string;
  additions?: number;
  deletions?: number;
}

export interface RepoClosedIssue {
  number: number;
  title: string;
  url: string;
  closedAt: string;
}

export interface RepoContributor {
  login: string;
  contributions: number;
  avatarUrl: string | null;
}

export interface RepoStatsSnapshot {
  repoFullName: string;
  defaultBranch: string | null;
  primaryLanguage: string | null;
  languageBytes: Record<string, number>;
  stargazers: number;
  forks: number;
  watchers: number;
  openIssues: number;
  openPullRequests: number;
  commitsLast7d: number;
  commitsLast30d: number;
  additionsLast30d: number;
  deletionsLast30d: number;
  mergedPrsLast30d: number;
  closedIssuesLast30d: number;
  currentStreakDays: number;
  /** 52 buckets, oldest first → newest last. Each bucket is total weekly commits. */
  weeklyCommitHistogram: number[];
  topContributors: RepoContributor[];
  recentCommits: RepoCommit[];
  recentMergedPrs: RepoMergedPr[];
  recentClosedIssues: RepoClosedIssue[];
  lastCommitAt: string | null;
}

async function ghJson<T>(url: string, token: string): Promise<T | null> {
  const r = await fetch(url, { headers: ghHeaders(token), cache: 'no-store' });
  // /stats/* returns 202 while GitHub computes — caller handles null.
  if (r.status === 202 || r.status === 204) return null;
  if (!r.ok) return null;
  return (await r.json().catch(() => null)) as T | null;
}

/** Compute consecutive-day commit streak ending today, in viewer's local-ish day boundaries (UTC). */
function computeStreak(commitDates: string[]): number {
  if (commitDates.length === 0) return 0;
  const days = new Set<string>();
  for (const d of commitDates) {
    const day = new Date(d).toISOString().slice(0, 10);
    days.add(day);
  }
  let streak = 0;
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  // Allow today OR yesterday as anchor (haven't committed yet today is fine).
  const todayKey = cursor.toISOString().slice(0, 10);
  if (!days.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < 365; i++) {
    const key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) break;
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/**
 * Pull a GitHub repo statistics snapshot.
 *
 * - `repoFullName`: 'owner/name'
 * - `viewer`: the github login of the integration owner; commit/PR activity
 *   windows are filtered to commits authored by this user.
 *
 * Best-effort: returns whatever endpoints succeeded; never throws on a
 * single failed sub-request. The caller can compare to the previous snapshot
 * to emit timeline events for new commits / merged PRs.
 */
export async function fetchRepoStatsSnapshot(
  token: string,
  repoFullName: string,
  viewer: string | null,
): Promise<RepoStatsSnapshot | null> {
  const meta = await ghJson<GhRepoMeta>(`${API}/repos/${repoFullName}`, token);
  if (!meta) return null;

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    languages,
    weeklyActivity,
    contributors,
    recentCommitsByViewer,
    last7Commits,
    openPrs,
    closedPrs,
    closedIssues,
  ] = await Promise.all([
    ghJson<Record<string, number>>(`${API}/repos/${repoFullName}/languages`, token),
    ghJson<Array<{ total: number; week: number; days: number[] }>>(
      `${API}/repos/${repoFullName}/stats/commit_activity`,
      token,
    ),
    ghJson<Array<{ login: string; contributions: number; avatar_url?: string }>>(
      `${API}/repos/${repoFullName}/contributors?per_page=10`,
      token,
    ),
    viewer
      ? ghJson<
          Array<{
            sha: string;
            html_url: string;
            commit: { message: string; author: { name?: string; date?: string } | null };
            author: { login?: string } | null;
          }>
        >(
          `${API}/repos/${repoFullName}/commits?author=${encodeURIComponent(
            viewer,
          )}&since=${since30}&per_page=100`,
          token,
        )
      : Promise.resolve(null),
    viewer
      ? ghJson<Array<{ sha: string }>>(
          `${API}/repos/${repoFullName}/commits?author=${encodeURIComponent(
            viewer,
          )}&since=${since7}&per_page=100`,
          token,
        )
      : Promise.resolve(null),
    ghJson<Array<unknown>>(`${API}/repos/${repoFullName}/pulls?state=open&per_page=100`, token),
    viewer
      ? ghJson<
          Array<{
            number: number;
            title: string;
            html_url: string;
            user: { login?: string } | null;
            merged_at: string | null;
            closed_at: string | null;
          }>
        >(
          `${API}/repos/${repoFullName}/pulls?state=closed&sort=updated&direction=desc&per_page=50`,
          token,
        )
      : Promise.resolve(null),
    viewer
      ? ghJson<
          Array<{
            number: number;
            title: string;
            html_url: string;
            user: { login?: string } | null;
            assignee: { login?: string } | null;
            closed_at: string | null;
            pull_request?: unknown;
          }>
        >(
          `${API}/repos/${repoFullName}/issues?state=closed&sort=updated&direction=desc&since=${since30}&per_page=100`,
          token,
        )
      : Promise.resolve(null),
  ]);

  // Open PRs are implicit: meta.open_issues_count includes both issues and PRs;
  // separate by counting the openPrs response. The open issue count is a derivation.
  const openPullRequests = Array.isArray(openPrs) ? openPrs.length : 0;
  const openIssues = Math.max((meta.open_issues_count ?? 0) - openPullRequests, 0);

  // Recent commits by viewer in last 30d.
  const commitsArr = recentCommitsByViewer ?? [];
  const recentCommits: RepoCommit[] = commitsArr.slice(0, 30).map((c) => ({
    sha: c.sha,
    message: (c.commit?.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
    authorLogin: c.author?.login ?? null,
    authorName: c.commit?.author?.name ?? null,
    url: c.html_url,
    authoredAt: c.commit?.author?.date ?? null,
  }));
  const commitDates = commitsArr.map((c) => c.commit?.author?.date).filter(Boolean) as string[];
  const lastCommitAt = commitDates[0] ?? meta.pushed_at ?? null;
  const commitsLast30d = commitsArr.length;
  const commitsLast7d = Array.isArray(last7Commits) ? last7Commits.length : 0;
  const currentStreakDays = computeStreak(commitDates);

  // Merged PRs by viewer in last 30d.
  const sinceMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const mergedPrsArr = (closedPrs ?? []).filter(
    (p) =>
      p.merged_at &&
      new Date(p.merged_at).getTime() >= sinceMs &&
      (!viewer || p.user?.login === viewer),
  );
  const recentMergedPrs: RepoMergedPr[] = mergedPrsArr.slice(0, 20).map((p) => ({
    number: p.number,
    title: p.title.slice(0, 200),
    url: p.html_url,
    mergedAt: p.merged_at!,
  }));

  // Closed issues touching viewer (author OR assignee) in last 30d. Skip PRs (they have pull_request).
  const closedIssuesArr = (closedIssues ?? []).filter(
    (i) =>
      !i.pull_request &&
      i.closed_at &&
      new Date(i.closed_at).getTime() >= sinceMs &&
      (!viewer || i.user?.login === viewer || i.assignee?.login === viewer),
  );
  const recentClosedIssues: RepoClosedIssue[] = closedIssuesArr.slice(0, 20).map((i) => ({
    number: i.number,
    title: i.title.slice(0, 200),
    url: i.html_url,
    closedAt: i.closed_at!,
  }));

  // Weekly histogram (52 weeks, total across all contributors — not just viewer).
  const weeklyCommitHistogram = Array.isArray(weeklyActivity)
    ? weeklyActivity.map((w) => w.total ?? 0)
    : [];

  return {
    repoFullName,
    defaultBranch: meta.default_branch ?? null,
    primaryLanguage: meta.language ?? null,
    languageBytes: languages ?? {},
    stargazers: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    watchers: meta.subscribers_count ?? 0,
    openIssues,
    openPullRequests,
    commitsLast7d,
    commitsLast30d,
    additionsLast30d: 0,
    deletionsLast30d: 0,
    mergedPrsLast30d: mergedPrsArr.length,
    closedIssuesLast30d: closedIssuesArr.length,
    currentStreakDays,
    weeklyCommitHistogram,
    topContributors: (contributors ?? []).slice(0, 10).map((c) => ({
      login: c.login,
      contributions: c.contributions,
      avatarUrl: c.avatar_url ?? null,
    })),
    recentCommits,
    recentMergedPrs,
    recentClosedIssues,
    lastCommitAt,
  };
}
