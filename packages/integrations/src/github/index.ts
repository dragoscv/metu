/** GitHub integration — webhook verification + commit/issue ingestion. */
import { Octokit } from 'octokit';
import { createHmac, timingSafeEqual } from 'node:crypto';

export * from './stats';

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

/**
 * Ensure a webhook on the repo points at our public ingest URL.
 *
 * - Skips silently when `process.env.GITHUB_WEBHOOK_SECRET` or `webhookUrl`
 *   is missing (local dev: no public URL ⇒ nothing useful to install).
 * - Idempotent: scans existing hooks for the same URL and only creates
 *   when absent. Updates the events list if it differs.
 * - Asks for the broadest event set we can usefully consume — including
 *   feature-branch pushes, reviews, security advisories, deployments.
 *   Any failure is swallowed and reported in the return value (we never
 *   want a failed hook install to break the link flow itself).
 */
export async function ensureRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  webhookUrl: string,
): Promise<{ ok: boolean; created: boolean; updated: boolean; reason?: string }> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return { ok: false, created: false, updated: false, reason: 'no-secret' };
  if (!webhookUrl) return { ok: false, created: false, updated: false, reason: 'no-url' };
  const desiredEvents = [
    'push',
    'create',
    'delete',
    'pull_request',
    'pull_request_review',
    'pull_request_review_comment',
    'commit_comment',
    'issues',
    'issue_comment',
    'discussion',
    'discussion_comment',
    'release',
    'workflow_run',
    'check_run',
    'deployment_status',
    'star',
    'fork',
    'member',
    'security_advisory',
    'repository_vulnerability_alert',
  ];
  try {
    const o = octokitForToken(token);
    const { data: hooks } = await o.rest.repos.listWebhooks({ owner, repo });
    const existing = hooks.find((h) => h.config?.url === webhookUrl);
    if (!existing) {
      await o.rest.repos.createWebhook({
        owner,
        repo,
        config: { url: webhookUrl, content_type: 'json', secret, insecure_ssl: '0' },
        events: desiredEvents,
        active: true,
      });
      return { ok: true, created: true, updated: false };
    }
    // Update the event list if drifted (don't touch secret — it's write-only on GH).
    const have = new Set(existing.events ?? []);
    const want = new Set(desiredEvents);
    const drift = want.size !== have.size || desiredEvents.some((e) => !have.has(e));
    if (drift) {
      await o.rest.repos.updateWebhook({
        owner,
        repo,
        hook_id: existing.id,
        events: desiredEvents,
        active: true,
      });
      return { ok: true, created: false, updated: true };
    }
    return { ok: true, created: false, updated: false };
  } catch (err) {
    return {
      ok: false,
      created: false,
      updated: false,
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    };
  }
}
