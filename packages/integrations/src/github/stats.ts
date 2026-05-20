/**
 * GitHub statistics collection.
 *
 * Pure REST helpers used by the `github-stats-sync` Inngest function. Keep
 * these idempotent and free of DB writes — the caller persists the result.
 *
 * `viewer` is the GitHub login that owns the workspace integration. Two
 * windows are reported per repo:
 *   - Viewer-attributed: `commitsLast{7,30}d`, `mergedPrsLast30d`,
 *     `closedIssuesLast30d`. These are filtered to commits / PRs / issues
 *     authored (or, for issues, assigned) to the viewer and constrained to
 *     the default branch by GitHub's `/commits` API.
 *   - Repo-wide / all-branch: `commitsAllLast{7,30}d`, `branchesActiveLast30d`,
 *     `contributorsLast30d`. Sourced from `/search/commits` which spans every
 *     ref in the repo, so feature-branch work and bot/co-author commits are
 *     captured. Used for "what's happening in this repo" intelligence.
 */

const API = 'https://api.github.com';

function ghHeaders(token: string): Record<string, string> {
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
  /** Branch (short ref) the commit was first seen on; null when ambiguous. */
  branch?: string | null;
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
  /** All-branch / all-author counts. */
  commitsAllLast7d: number;
  commitsAllLast30d: number;
  branchesActiveLast30d: number;
  contributorsLast30d: number;
  branchesTotal: number;
  currentStreakDays: number;
  /** 52 buckets, oldest first → newest last. Each bucket is total weekly commits. */
  weeklyCommitHistogram: number[];
  topContributors: RepoContributor[];
  /** Recent commits — viewer + all-branch, deduped by sha. Oldest dropped past 60. */
  recentCommits: RepoCommit[];
  recentMergedPrs: RepoMergedPr[];
  recentClosedIssues: RepoClosedIssue[];
  lastCommitAt: string | null;
}

async function ghJson<T>(url: string, token: string): Promise<T | null> {
  // Retry on 429 / secondary rate limits using GitHub's `retry-after` /
  // `x-ratelimit-reset` hints. Bounded at 3 attempts to avoid Inngest timeouts.
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: ghHeaders(token) });
    // /stats/* returns 202 while GitHub computes — caller handles null.
    if (r.status === 202 || r.status === 204) return null;
    if (r.status === 429 || (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0')) {
      const retryAfter = Number(r.headers.get('retry-after'));
      const reset = Number(r.headers.get('x-ratelimit-reset'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30_000)
          : Number.isFinite(reset) && reset > 0
            ? Math.min(Math.max(reset * 1000 - Date.now(), 1_000), 30_000)
            : 2_000 * Math.pow(2, attempt);
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }
    if (!r.ok) return null;
    return (await r.json().catch(() => null)) as T | null;
  }
  return null;
}

/**
 * Walk the `Link: rel="next"` header to fetch up to `maxPages` pages.
 * Used for endpoints where 100/page isn't enough (branches, contributors
 * on large repos). We cap pages explicitly so a single sync can't run
 * away with a 1000-branch repo.
 */
async function ghJsonPaginated<T>(
  baseUrl: string,
  token: string,
  maxPages = 3,
): Promise<T[] | null> {
  const out: T[] = [];
  let url: string | null = baseUrl;
  for (let i = 0; i < maxPages && url; i++) {
    let page: T[] | null = null;
    let next: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r: Response = await fetch(url, { headers: ghHeaders(token) });
      if (r.status === 202 || r.status === 204) return out.length > 0 ? out : null;
      if (
        r.status === 429 ||
        (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0')
      ) {
        const retryAfter = Number(r.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 30_000)
            : 2_000 * Math.pow(2, attempt);
        await new Promise((res) => setTimeout(res, waitMs));
        continue;
      }
      if (!r.ok) return out.length > 0 ? out : null;
      page = (await r.json().catch(() => null)) as T[] | null;
      const link: string | null = r.headers.get('link');
      next = link ? parseNextLink(link) : null;
      break;
    }
    if (!Array.isArray(page)) break;
    out.push(...page);
    url = next;
  }
  return out;
}

/** Parse the `Link` header for the `rel="next"` URL (or null). */
function parseNextLink(header: string): string | null {
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1] ?? null;
  }
  return null;
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
  const since30Day = since30.slice(0, 10); // YYYY-MM-DD for search/commits.

  // Enumerate branches (up to 3 pages × 100 = 300 branches per repo).
  const branchesList = await ghJsonPaginated<{ name: string }>(
    `${API}/repos/${repoFullName}/branches?per_page=100`,
    token,
  );
  const branchNames = (branchesList ?? []).map((b) => b.name);
  const branchesTotal = branchNames.length;

  const [
    languages,
    weeklyActivity,
    contributors,
    recentCommitsByViewer,
    last7Commits,
    openPrs,
    closedPrs,
    closedIssues,
    allBranchCommits30d,
  ] = await Promise.all([
    ghJson<Record<string, number>>(`${API}/repos/${repoFullName}/languages`, token),
    ghJson<Array<{ total: number; week: number; days: number[] }>>(
      `${API}/repos/${repoFullName}/stats/commit_activity`,
      token,
    ),
    ghJsonPaginated<{ login: string; contributions: number; avatar_url?: string }>(
      `${API}/repos/${repoFullName}/contributors?per_page=100`,
      token,
      2,
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
    // All-branch commits via Search Commits API. Searches every ref in the
    // repo (default branch + every feature branch). Limited to 100/page; we
    // pull a single page since 30d > 100 is unusual for one repo.
    ghJson<{
      items?: Array<{
        sha: string;
        html_url: string;
        commit: { message: string; author: { name?: string; date?: string } | null };
        author: { login?: string } | null;
      }>;
      total_count?: number;
    }>(
      `${API}/search/commits?q=${encodeURIComponent(
        `repo:${repoFullName} author-date:>${since30Day}`,
      )}&sort=author-date&order=desc&per_page=100`,
      token,
    ),
  ]);

  // Open PRs are implicit: meta.open_issues_count includes both issues and PRs;
  // separate by counting the openPrs response. The open issue count is a derivation.
  const openPullRequests = Array.isArray(openPrs) ? openPrs.length : 0;
  const openIssues = Math.max((meta.open_issues_count ?? 0) - openPullRequests, 0);

  // Recent commits by viewer in last 30d.
  const commitsArr = recentCommitsByViewer ?? [];
  const viewerCommits: RepoCommit[] = commitsArr.slice(0, 30).map((c) => ({
    sha: c.sha,
    message: (c.commit?.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
    authorLogin: c.author?.login ?? null,
    authorName: c.commit?.author?.name ?? null,
    url: c.html_url,
    authoredAt: c.commit?.author?.date ?? null,
    branch: meta.default_branch ?? null,
  }));
  const commitDates = commitsArr.map((c) => c.commit?.author?.date).filter(Boolean) as string[];
  const lastCommitAt = commitDates[0] ?? meta.pushed_at ?? null;
  const commitsLast30d = commitsArr.length;
  const commitsLast7d = Array.isArray(last7Commits) ? last7Commits.length : 0;
  const currentStreakDays = computeStreak(commitDates);

  // All-branch commit aggregation (Search Commits returns ALL refs).
  const searchItems = allBranchCommits30d?.items ?? [];
  const sevenAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const commitsAllLast30d = allBranchCommits30d?.total_count ?? searchItems.length;
  const commitsAllLast7d = searchItems.filter((c) => {
    const d = c.commit?.author?.date;
    return d ? new Date(d).getTime() >= sevenAgoMs : false;
  }).length;
  const allBranchCommits: RepoCommit[] = searchItems.slice(0, 60).map((c) => ({
    sha: c.sha,
    message: (c.commit?.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
    authorLogin: c.author?.login ?? null,
    authorName: c.commit?.author?.name ?? null,
    url: c.html_url,
    authoredAt: c.commit?.author?.date ?? null,
    branch: null, // Search API doesn't return branch; resolved later if needed.
  }));
  const distinctAuthors = new Set<string>();
  for (const c of searchItems) {
    const a = c.author?.login ?? c.commit?.author?.name ?? null;
    if (a) distinctAuthors.add(a);
  }
  const contributorsLast30d = distinctAuthors.size;

  // Estimate active branches — those where the tip commit is within 30d.
  // Single API call already gave us tip SHAs but not dates. Approximate by
  // checking each branch's tip date in parallel (capped at 30 to bound cost).
  const branchTipChecks = await Promise.all(
    branchNames.slice(0, 30).map(async (name) => {
      const tip = await ghJson<{
        commit?: { author?: { date?: string } | null };
      }>(`${API}/repos/${repoFullName}/branches/${encodeURIComponent(name)}`, token);
      const date = tip?.commit?.author?.date;
      return { name, fresh: date ? new Date(date).getTime() >= Date.now() - 30 * 86400000 : false };
    }),
  );
  const branchesActiveLast30d = branchTipChecks.filter((b) => b.fresh).length;

  // Merge viewer commits (which know the default branch) with all-branch
  // commits (which include feature branches), dedupe by sha.
  const mergedMap = new Map<string, RepoCommit>();
  for (const c of viewerCommits) mergedMap.set(c.sha, c);
  for (const c of allBranchCommits) {
    if (!mergedMap.has(c.sha)) mergedMap.set(c.sha, c);
  }
  const recentCommits = Array.from(mergedMap.values())
    .sort((a, b) => (b.authoredAt ?? '').localeCompare(a.authoredAt ?? ''))
    .slice(0, 60);

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
    commitsAllLast7d,
    commitsAllLast30d,
    branchesActiveLast30d,
    contributorsLast30d,
    branchesTotal,
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
