/**
 * GitHub repo-webhook installer.
 *
 * Triggered from `addProjectLinkAction` whenever a GitHub repo is linked
 * to a project. Opens the integration's sealed token, calls
 * `ensureRepoWebhook()` against the repo, and records the outcome on the
 * integration's `config.webhooks` map for observability.
 *
 * We never block the user-facing action on this — Inngest's retry/backoff
 * handles transient failures. The real-time path (push, PRs, issues, …)
 * starts working as soon as GitHub accepts the hook.
 */
import { and, eq } from 'drizzle-orm';
import { open as openSealed } from '@metu/ai';
import { getDb } from '@metu/db';
import { integration } from '@metu/db/schema';
import { ensureRepoWebhook } from '@metu/integrations/github';
import { inngest } from '../client';
import { parseEvent } from '../schemas';

export const onGithubRepoWebhookEnsure = inngest.createFunction(
  {
    id: 'github-repo-webhook-ensure',
    name: 'GitHub: ensure repo webhook',
    concurrency: { limit: 5, key: 'event.data.workspaceId' },
    retries: 3,
  },
  { event: 'github/repo.webhook.ensure' },
  async ({ event, step }) => {
    const data = parseEvent('github/repo.webhook.ensure', event.data);
    const { workspaceId, integrationId, repoFullName, webhookUrl } = data;

    const creds = await step.run('open-token', async () => {
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
      const tag = (row.config as { tokenTag?: string })?.tokenTag;
      if (!tag) return null;
      try {
        const token = await openSealed({
          ciphertext: row.tokenCiphertext,
          iv: row.tokenIv,
          tag,
        });
        return { token, config: (row.config ?? {}) as Record<string, unknown> };
      } catch {
        return null;
      }
    });
    if (!creds) return { ok: false, reason: 'no-token' };

    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) return { ok: false, reason: 'bad-repo' };

    const result = await step.run('ensure', () =>
      ensureRepoWebhook(creds.token, owner, repo, webhookUrl),
    );

    await step.run('record', async () => {
      const db = getDb();
      const cfg = creds.config as Record<string, unknown>;
      const existing = (cfg.webhooks ?? {}) as Record<string, unknown>;
      const nextCfg = {
        ...cfg,
        webhooks: {
          ...existing,
          [repoFullName]: {
            url: webhookUrl,
            installedAt: new Date().toISOString(),
            ok: result.ok,
            reason: result.reason ?? null,
            created: result.created,
            updated: result.updated,
          },
        },
      };
      await db
        .update(integration)
        .set({ config: nextCfg })
        .where(and(eq(integration.id, integrationId), eq(integration.workspaceId, workspaceId)));
    });

    return result;
  },
);
