'use server';
import { open as openSealed } from '@metu/ai';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import {
  getIntegrationResourceByExternalId,
  listLinkedGithubRepos,
  projectByGithubRepo,
} from '@metu/db/queries';
import { integration, task, timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { addProjectLinkAction } from './project-links';

export interface GithubAccount {
  id: string;
  login: string;
  label: string;
  scopes: string[];
}

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  description: string | null;
  private: boolean;
  url: string;
  language: string | null;
  defaultBranch: string;
  stars: number;
  pushedAt: string | null;
  ownerAvatarUrl: string | null;
  fork: boolean;
  archived: boolean;
}

async function getGithubToken(workspaceId: string, integrationId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, integrationId),
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, 'github'),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: 'Integration not found' };
  if (row.status !== 'active') return { ok: false as const, error: `Integration ${row.status}` };
  if (!row.tokenCiphertext || !row.tokenIv) return { ok: false as const, error: 'No token stored' };
  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) return { ok: false as const, error: 'token_tag missing' };
  try {
    const token = openSealed({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: tokenTag,
    });
    return { ok: true as const, token, externalId: row.externalId, label: row.label };
  } catch {
    return { ok: false as const, error: 'unseal_failed' };
  }
}

export async function listGithubAccountsAction() {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const db = getDb();
  const rows = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, session.user.workspaceId),
        eq(integration.kind, 'github'),
        eq(integration.status, 'active'),
      ),
    );
  const accounts: GithubAccount[] = rows.map((r) => ({
    id: r.id,
    login: r.externalId,
    label: r.label,
    scopes: ((r.config as { scopes?: string[] })?.scopes ?? []) as string[],
  }));
  return { ok: true as const, accounts };
}

interface GithubApiRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  language: string | null;
  default_branch: string;
  stargazers_count: number;
  pushed_at: string | null;
  fork: boolean;
  archived: boolean;
  owner: { login: string; avatar_url: string };
}

export interface LinkedGithubRepo {
  fullName: string;
  url: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}

/** All GitHub repos already linked to projects in the workspace, keyed by fullName. */
export async function listLinkedGithubReposAction(): Promise<
  { ok: true; linked: LinkedGithubRepo[] } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const rows = await listLinkedGithubRepos(session.user.workspaceId);
  const linked: LinkedGithubRepo[] = rows
    .filter((r): r is typeof r & { fullName: string } => Boolean(r.fullName))
    .map((r) => ({
      fullName: r.fullName,
      url: r.url,
      projectId: r.projectId,
      projectName: r.projectName,
      projectSlug: r.projectSlug,
    }));
  return { ok: true, linked };
}

export async function listGithubReposAction(input: {
  integrationId: string;
  search?: string;
  perPage?: number;
  owner?: string;
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const tok = await getGithubToken(session.user.workspaceId, input.integrationId);
  if (!tok.ok) return tok;

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Use search endpoint when query provided, otherwise list user's repos sorted by pushed.
  let url: string;
  const perPage = Math.min(Math.max(input.perPage ?? 30, 1), 100);
  const ownerScope = input.owner && input.owner.trim() ? input.owner.trim() : null;
  const isOrgScope = ownerScope && ownerScope !== tok.externalId;
  if (input.search && input.search.trim()) {
    const scope = ownerScope
      ? isOrgScope
        ? `org:${ownerScope}`
        : `user:${ownerScope}`
      : `user:${tok.externalId}`;
    const q = `${input.search.trim()} in:name fork:true ${scope}`;
    url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${perPage}`;
  } else if (isOrgScope) {
    url = `https://api.github.com/orgs/${encodeURIComponent(ownerScope)}/repos?sort=pushed&per_page=${perPage}`;
  } else {
    url = `https://api.github.com/user/repos?sort=pushed&per_page=${perPage}&affiliation=owner,collaborator,organization_member`;
  }

  let repos: GithubApiRepo[] = [];
  try {
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false as const, error: `GitHub ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = (await res.json()) as GithubApiRepo[] | { items: GithubApiRepo[] };
    repos = Array.isArray(data) ? data : (data.items ?? []);
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'fetch failed',
    };
  }

  // Post-filter for user-scope when listing /user/repos (which spans all orgs).
  if (ownerScope && !isOrgScope && !(input.search && input.search.trim())) {
    repos = repos.filter((r) => r.owner.login.toLowerCase() === ownerScope.toLowerCase());
  }

  const out: GithubRepo[] = repos.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    description: r.description,
    private: r.private,
    url: r.html_url,
    language: r.language,
    defaultBranch: r.default_branch,
    stars: r.stargazers_count,
    pushedAt: r.pushed_at,
    ownerAvatarUrl: r.owner.avatar_url,
    fork: r.fork ?? false,
    archived: r.archived ?? false,
  }));
  return { ok: true as const, repos: out };
}

export async function assignGithubRepoAction(input: {
  projectId: string;
  integrationId: string;
  repo: GithubRepo;
}) {
  return addProjectLinkAction({
    projectId: input.projectId,
    provider: 'github',
    kind: 'repo',
    url: input.repo.url,
    title: input.repo.fullName,
    metadata: {
      fullName: input.repo.fullName,
      private: input.repo.private,
      language: input.repo.language,
      defaultBranch: input.repo.defaultBranch,
      stars: input.repo.stars,
      pushedAt: input.repo.pushedAt,
    },
    resource: {
      integrationId: input.integrationId,
      externalId: input.repo.fullName,
      title: input.repo.fullName,
      url: input.repo.url,
      metadata: {
        repoId: input.repo.id,
        owner: input.repo.owner,
        ownerAvatarUrl: input.repo.ownerAvatarUrl,
        private: input.repo.private,
        description: input.repo.description,
        language: input.repo.language,
        defaultBranch: input.repo.defaultBranch,
        stars: input.repo.stars,
        pushedAt: input.repo.pushedAt,
      },
    },
  });
}

// ----------------- Per-repo detail + import -----------------

interface GithubCommit {
  sha: string;
  message: string;
  url: string;
  author: { login: string | null; avatarUrl: string | null; date: string | null };
}

interface GithubIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  isPullRequest: boolean;
  body: string | null;
  labels: string[];
  user: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GithubRepoDetail {
  repo: GithubRepo;
  commits: GithubCommit[];
  issues: GithubIssue[];
  pulls: GithubIssue[];
}

async function pickGithubIntegrationForRepo(
  workspaceId: string,
  ownerLogin: string,
): Promise<{ ok: true; integrationId: string } | { ok: false; error: string }> {
  const db = getDb();
  // Prefer integration whose externalId === owner login.
  const [exact] = await db
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, 'github'),
        eq(integration.status, 'active'),
        eq(integration.externalId, ownerLogin),
      ),
    )
    .limit(1);
  if (exact) return { ok: true, integrationId: exact.id };
  const [first] = await db
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.workspaceId, workspaceId),
        eq(integration.kind, 'github'),
        eq(integration.status, 'active'),
      ),
    )
    .limit(1);
  if (!first) return { ok: false, error: 'No GitHub account connected' };
  return { ok: true, integrationId: first.id };
}

export async function getGithubRepoDetailAction(input: { owner: string; repo: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const fullName = `${input.owner}/${input.repo}`;

  const pick = await pickGithubIntegrationForRepo(session.user.workspaceId, input.owner);
  if (!pick.ok) return { ok: false as const, error: pick.error };

  const tok = await getGithubToken(session.user.workspaceId, pick.integrationId);
  if (!tok.ok) return tok;

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const baseUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;

  let repoData: GithubApiRepo;
  try {
    const res = await fetch(baseUrl, { headers, cache: 'no-store' });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false as const, error: `GitHub ${res.status}: ${txt.slice(0, 200)}` };
    }
    repoData = (await res.json()) as GithubApiRepo;
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'fetch failed' };
  }

  // Fetch commits + issues+PRs in parallel; tolerate individual failures.
  const [commitsResRaw, issuesResRaw] = await Promise.allSettled([
    fetch(`${baseUrl}/commits?per_page=15`, { headers, cache: 'no-store' }),
    fetch(`${baseUrl}/issues?state=open&per_page=30&sort=updated`, { headers, cache: 'no-store' }),
  ]);

  let commits: GithubCommit[] = [];
  if (commitsResRaw.status === 'fulfilled' && commitsResRaw.value.ok) {
    const json = (await commitsResRaw.value.json().catch(() => [])) as Array<{
      sha: string;
      html_url: string;
      commit: { message: string; author: { name?: string; date?: string } | null };
      author: { login?: string; avatar_url?: string } | null;
    }>;
    commits = json.map((c) => ({
      sha: c.sha,
      message: c.commit?.message ?? '',
      url: c.html_url,
      author: {
        login: c.author?.login ?? null,
        avatarUrl: c.author?.avatar_url ?? null,
        date: c.commit?.author?.date ?? null,
      },
    }));
  }

  let allIssues: GithubIssue[] = [];
  if (issuesResRaw.status === 'fulfilled' && issuesResRaw.value.ok) {
    const json = (await issuesResRaw.value.json().catch(() => [])) as Array<{
      number: number;
      title: string;
      state: string;
      html_url: string;
      pull_request?: unknown;
      body: string | null;
      labels: Array<{ name: string } | string>;
      user: { login?: string } | null;
      created_at: string;
      updated_at: string;
    }>;
    allIssues = json.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      url: i.html_url,
      isPullRequest: !!i.pull_request,
      body: i.body,
      labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      user: i.user?.login ?? null,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
    }));
  }

  const issues = allIssues.filter((i) => !i.isPullRequest);
  const pulls = allIssues.filter((i) => i.isPullRequest);

  const repo: GithubRepo = {
    id: repoData.id,
    fullName: repoData.full_name,
    name: repoData.name,
    owner: repoData.owner.login,
    description: repoData.description,
    private: repoData.private,
    url: repoData.html_url,
    language: repoData.language,
    defaultBranch: repoData.default_branch,
    stars: repoData.stargazers_count,
    pushedAt: repoData.pushed_at,
    ownerAvatarUrl: repoData.owner.avatar_url,
    fork: repoData.fork ?? false,
    archived: repoData.archived ?? false,
  };

  // Resolve linked project + cached resource for context.
  const projectId = await projectByGithubRepo(session.user.workspaceId, fullName);
  const cachedResource = await getIntegrationResourceByExternalId(
    session.user.workspaceId,
    'github',
    fullName,
  );

  return {
    ok: true as const,
    detail: { repo, commits, issues, pulls } satisfies GithubRepoDetail,
    integrationId: pick.integrationId,
    linkedProjectId: projectId,
    cachedResourceId: cachedResource?.id ?? null,
  };
}

// ----------------- Import issues / PRs as tasks -----------------

export async function importGithubIssuesAction(input: {
  projectId: string;
  owner: string;
  repo: string;
  kinds: { issues: boolean; pulls: boolean };
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  if (!input.kinds.issues && !input.kinds.pulls)
    return { ok: false as const, error: 'Pick issues or PRs' };

  const detail = await getGithubRepoDetailAction({ owner: input.owner, repo: input.repo });
  if (!detail.ok) return { ok: false as const, error: detail.error };

  const fullName = `${input.owner}/${input.repo}`;
  const items = [
    ...(input.kinds.issues ? detail.detail.issues : []),
    ...(input.kinds.pulls ? detail.detail.pulls : []),
  ];
  if (items.length === 0) return { ok: true as const, imported: 0, skipped: 0 };

  const db = getDb();
  // Find tasks already imported for this repo to avoid duplicates.
  const existing = await db
    .select({ ref: task.sourceEntityRef })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, session.user.workspaceId),
        eq(task.projectId, input.projectId),
        eq(task.sourceApp, 'github'),
        sql`${task.sourceEntityRef} ->> 'repo' = ${fullName}`,
      ),
    );
  const existingNumbers = new Set<number>();
  for (const e of existing) {
    const ref = e.ref as { number?: number } | null;
    if (ref && typeof ref.number === 'number') existingNumbers.add(ref.number);
  }

  const toInsert = items.filter((i) => !existingNumbers.has(i.number));
  if (toInsert.length === 0) return { ok: true as const, imported: 0, skipped: items.length };

  await db.insert(task).values(
    toInsert.map((i) => ({
      workspaceId: session.user.workspaceId,
      projectId: input.projectId,
      title: `${i.isPullRequest ? 'PR' : 'Issue'} #${i.number}: ${i.title}`.slice(0, 240),
      body: i.body,
      status: 'inbox' as const,
      kind: 'shallow' as const,
      sourceApp: 'github',
      sourceUrl: i.url,
      sourceEntityRef: {
        kind: i.isPullRequest ? 'pull_request' : 'issue',
        number: i.number,
        repo: fullName,
        labels: i.labels,
        author: i.user,
      },
    })),
  );

  await db.insert(timelineEvent).values({
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
    projectId: input.projectId,
    kind: 'project.imported_github',
    title: `Imported ${toInsert.length} from ${fullName}`,
    importance: 0.5,
    payload: { repo: fullName, count: toInsert.length },
  });

  revalidatePath(`/projects/${input.projectId}`);
  revalidatePath(`/projects/${input.projectId}/edit`);
  revalidatePath(`/integrations/github/${input.owner}/${input.repo}`);

  return { ok: true as const, imported: toInsert.length, skipped: items.length - toInsert.length };
}

// ----------------- Create new repo + parse-by-URL -----------------

/** POST /user/repos or /orgs/{owner}/repos — create a new repository. */
export async function createGithubRepoAction(input: {
  integrationId: string;
  name: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
  owner?: string;
}) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const trimmed = input.name.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(trimmed))
    return { ok: false as const, error: 'Invalid repo name' };
  const tok = await getGithubToken(session.user.workspaceId, input.integrationId);
  if (!tok.ok) return tok;

  const ownerScope = input.owner && input.owner.trim() ? input.owner.trim() : null;
  const isOrgScope = ownerScope && ownerScope !== tok.externalId;
  const url = isOrgScope
    ? `https://api.github.com/orgs/${encodeURIComponent(ownerScope)}/repos`
    : 'https://api.github.com/user/repos';

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tok.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: trimmed,
        description: input.description?.slice(0, 350),
        private: input.private ?? true,
        auto_init: input.autoInit ?? true,
      }),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'fetch failed' };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    return { ok: false as const, error: `GitHub ${res.status}: ${txt.slice(0, 300)}` };
  }
  const data = (await res.json()) as GithubApiRepo;
  const out: GithubRepo = {
    id: data.id,
    fullName: data.full_name,
    name: data.name,
    owner: data.owner.login,
    description: data.description,
    private: data.private,
    url: data.html_url,
    language: data.language,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    pushedAt: data.pushed_at,
    ownerAvatarUrl: data.owner.avatar_url,
    fork: data.fork ?? false,
    archived: data.archived ?? false,
  };
  return { ok: true as const, repo: out };
}

export interface GithubOwnerOption {
  login: string;
  kind: 'user' | 'org';
  avatarUrl: string | null;
  canCreate: boolean;
}

/** GET /user/orgs — list orgs the connected user belongs to (plus the user itself). */
export async function listGithubOwnersAction(input: { integrationId: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const tok = await getGithubToken(session.user.workspaceId, input.integrationId);
  if (!tok.ok) return tok;

  const headers = {
    Authorization: `Bearer ${tok.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let userAvatar: string | null = null;
  try {
    const r = await fetch('https://api.github.com/user', { headers, cache: 'no-store' });
    if (r.ok) {
      const u = (await r.json()) as { avatar_url?: string };
      userAvatar = u.avatar_url ?? null;
    }
  } catch {
    // ignore — we'll just use null avatar
  }

  let orgs: Array<{ login: string; avatar_url: string }> = [];
  try {
    const r = await fetch('https://api.github.com/user/orgs?per_page=100', {
      headers,
      cache: 'no-store',
    });
    if (r.ok) orgs = (await r.json()) as Array<{ login: string; avatar_url: string }>;
  } catch {
    // ignore — orgs scope may not be granted
  }

  const owners: GithubOwnerOption[] = [
    { login: tok.externalId, kind: 'user', avatarUrl: userAvatar, canCreate: true },
    ...orgs.map((o) => ({
      login: o.login,
      kind: 'org' as const,
      avatarUrl: o.avatar_url,
      canCreate: true,
    })),
  ];
  return { ok: true as const, owners };
}

/** Resolve a GitHub URL like https://github.com/owner/repo to repo metadata.
 *  Picks an integration matching the owner login; falls back to first active one. */
export async function getGithubRepoByUrlAction(input: { url: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  let owner: string;
  let repo: string;
  try {
    const u = new URL(input.url);
    if (!/(^|\.)github\.com$/.test(u.hostname))
      return { ok: false as const, error: 'Not a github.com URL' };
    const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return { ok: false as const, error: 'URL missing owner/repo' };
    owner = parts[0]!;
    repo = parts[1]!.replace(/\.git$/, '');
  } catch {
    return { ok: false as const, error: 'Invalid URL' };
  }
  const detail = await getGithubRepoDetailAction({ owner, repo });
  if (!detail.ok) return detail;
  return { ok: true as const, repo: detail.detail.repo, integrationId: detail.integrationId };
}
