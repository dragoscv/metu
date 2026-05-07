/**
 * GitHub repo memory seeding.
 *
 * Triggered the moment a repo is linked to a project (`github/repo.linked`).
 * Pulls README + open issues + recent commits via the workspace's GitHub
 * integration token, indexes each as a memory chunk, and finally pings the
 * Conductor so it knows there's new context to reason about.
 */
import { and, eq } from 'drizzle-orm';
import { open as openSealed } from '@metu/ai';
import { getDb } from '@metu/db';
import { integration, timelineEvent } from '@metu/db/schema';
import { memory } from '@metu/core';
import { inngest } from '../client';

interface RepoMeta {
  full_name: string;
  description: string | null;
  default_branch: string;
  language: string | null;
  topics?: string[];
  stargazers_count?: number;
  pushed_at?: string;
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
  if (!row || !row.tokenCiphertext || !row.tokenIv) return null;
  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) return null;
  try {
    return openSealed({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: tokenTag,
    });
  } catch {
    return null;
  }
}

export const onGithubRepoLinked = inngest.createFunction(
  {
    id: 'github-repo-linked',
    name: 'GitHub: seed repo memory',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
  },
  { event: 'github/repo.linked' },
  async ({ event, step }) => {
    const { workspaceId, projectId, integrationId, repoFullName, repoUrl } = event.data;

    const token = await step.run('token', () => getGithubToken(workspaceId, integrationId));
    if (!token) {
      return { ok: false, reason: 'no-token' };
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const apiBase = `https://api.github.com/repos/${repoFullName}`;

    // 1. Repo metadata
    const repoMeta = await step.run('repo-meta', async () => {
      const r = await fetch(apiBase, { headers, cache: 'no-store' });
      if (!r.ok) return null;
      return (await r.json()) as RepoMeta;
    });

    let chunkCount = 0;

    if (repoMeta) {
      const summary = [
        `Repository: ${repoMeta.full_name}`,
        repoMeta.description ? `Description: ${repoMeta.description}` : null,
        repoMeta.language ? `Primary language: ${repoMeta.language}` : null,
        repoMeta.topics?.length ? `Topics: ${repoMeta.topics.join(', ')}` : null,
        `URL: ${repoUrl}`,
      ]
        .filter(Boolean)
        .join('\n');
      const r = await step.run('index-summary', () =>
        memory.indexMemory({
          workspaceId,
          projectId,
          sourceKind: 'project_summary',
          content: summary,
          metadata: {
            repo: repoFullName,
            kind: 'repo_summary',
            externalId: `github:${repoFullName}`,
          },
        }),
      );
      chunkCount += r.chunkCount;
    }

    // 2. README
    await step.run('readme', async () => {
      const r = await fetch(`${apiBase}/readme`, {
        headers: { ...headers, Accept: 'application/vnd.github.raw' },
        cache: 'no-store',
      });
      if (!r.ok) return;
      const text = await r.text();
      if (!text || text.length < 40) return;
      const indexed = await memory.indexMemory({
        workspaceId,
        projectId,
        sourceKind: 'repo_file',
        content: text.slice(0, 40_000),
        metadata: {
          repo: repoFullName,
          file: 'README.md',
          externalId: `github:${repoFullName}:README`,
        },
      });
      chunkCount += indexed.chunkCount;
    });

    // 3. Open issues (top 30)
    await step.run('issues', async () => {
      const r = await fetch(`${apiBase}/issues?state=open&per_page=30&sort=updated`, {
        headers,
        cache: 'no-store',
      });
      if (!r.ok) return;
      const issues = (await r.json().catch(() => [])) as Array<{
        number: number;
        title: string;
        body: string | null;
        pull_request?: unknown;
        html_url: string;
        labels: Array<{ name: string } | string>;
        user: { login?: string } | null;
      }>;
      for (const issue of issues) {
        if (issue.pull_request) continue; // skip PRs here
        const content = [
          `Issue #${issue.number}: ${issue.title}`,
          issue.user?.login ? `Reported by: ${issue.user.login}` : null,
          (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean)
            .length
            ? `Labels: ${(issue.labels ?? [])
                .map((l) => (typeof l === 'string' ? l : l.name))
                .filter(Boolean)
                .join(', ')}`
            : null,
          issue.body ? `\n${issue.body.slice(0, 4_000)}` : null,
          `\n${issue.html_url}`,
        ]
          .filter(Boolean)
          .join('\n');
        const indexed = await memory.indexMemory({
          workspaceId,
          projectId,
          sourceKind: 'task',
          content,
          metadata: {
            repo: repoFullName,
            issueNumber: issue.number,
            url: issue.html_url,
            externalId: `github:${repoFullName}:issue:${issue.number}`,
          },
        });
        chunkCount += indexed.chunkCount;
      }
    });

    // 4. Recent commits (top 15)
    await step.run('commits', async () => {
      const r = await fetch(`${apiBase}/commits?per_page=15`, {
        headers,
        cache: 'no-store',
      });
      if (!r.ok) return;
      const commits = (await r.json().catch(() => [])) as Array<{
        sha: string;
        html_url: string;
        commit: {
          message: string;
          author: { name?: string; date?: string } | null;
        };
        author: { login?: string } | null;
      }>;
      for (const c of commits) {
        const msg = c.commit?.message ?? '';
        if (!msg) continue;
        const content = [
          `Commit ${c.sha.slice(0, 7)} — ${c.author?.login ?? c.commit.author?.name ?? 'unknown'}`,
          msg.slice(0, 2_000),
          c.html_url,
        ].join('\n');
        const indexed = await memory.indexMemory({
          workspaceId,
          projectId,
          sourceKind: 'commit',
          content,
          metadata: {
            repo: repoFullName,
            sha: c.sha,
            url: c.html_url,
            authoredAt: c.commit?.author?.date ?? null,
            externalId: `github:${repoFullName}:commit:${c.sha}`,
          },
        });
        chunkCount += indexed.chunkCount;
      }
    });

    // 5. Audit + wake the conductor
    await step.run('audit', async () => {
      const db = getDb();
      await db.insert(timelineEvent).values({
        workspaceId,
        projectId,
        kind: 'github.repo.indexed',
        title: `Indexed ${repoFullName}`,
        importance: 0.6,
        payload: { repo: repoFullName, chunks: chunkCount },
      });
    });

    await step.sendEvent('observe', {
      name: 'conductor/observe',
      data: {
        workspaceId,
        eventKind: 'github.repo.indexed',
        payload: { projectId, repoFullName, chunks: chunkCount },
      },
    });

    return { ok: true, chunks: chunkCount };
  },
);
