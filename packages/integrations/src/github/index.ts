/** GitHub integration — webhook verification + commit/issue ingestion. */
import { Octokit } from 'octokit';
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyGithubWebhook(payload: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error('GITHUB_WEBHOOK_SECRET not set');
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function octokitForToken(token: string) {
  return new Octokit({ auth: token });
}

export async function listRecentCommits(token: string, owner: string, repo: string) {
  const o = octokitForToken(token);
  const { data } = await o.rest.repos.listCommits({ owner, repo, per_page: 30 });
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name ?? c.author?.login ?? 'unknown',
    url: c.html_url,
    date: c.commit.author?.date ?? null,
  }));
}

export async function readRepoFile(token: string, owner: string, repo: string, path: string) {
  const o = octokitForToken(token);
  const { data } = await o.rest.repos.getContent({ owner, repo, path });
  if (Array.isArray(data) || data.type !== 'file') return null;
  return Buffer.from(data.content, 'base64').toString('utf8');
}
