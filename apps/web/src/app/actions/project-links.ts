'use server';
import { revalidatePath } from 'next/cache';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { integrationResource, project, projectLink, timelineEvent } from '@metu/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { inngest } from '@/inngest/client';

const ALLOWED_KIND = z.enum(['repo', 'url', 'page', 'issue', 'channel', 'doc', 'board']);
const ALLOWED_PROVIDER = z.enum([
  'github',
  'gitlab',
  'notion',
  'linear',
  'slack',
  'gdrive',
  'figma',
  'generic',
]);

const addLinkSchema = z.object({
  projectId: z.string().uuid(),
  provider: ALLOWED_PROVIDER,
  kind: ALLOWED_KIND,
  url: z.string().url(),
  title: z.string().min(1).max(280),
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Optional integration_resource snapshot (used for GitHub repos). */
  resource: z
    .object({
      integrationId: z.string().uuid().optional(),
      externalId: z.string().min(1),
      title: z.string().min(1),
      url: z.string().url(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type AddLinkInput = z.infer<typeof addLinkSchema>;

async function ownedProject(workspaceId: string, projectId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

export async function addProjectLinkAction(input: AddLinkInput) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const parsed = addLinkSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  const wsId = session.user.workspaceId;
  if (!(await ownedProject(wsId, parsed.data.projectId)))
    return { ok: false as const, error: 'Project not found' };
  const db = getDb();

  let resourceId: string | null = null;
  if (parsed.data.resource) {
    const r = parsed.data.resource;
    const [resRow] = await db
      .insert(integrationResource)
      .values({
        workspaceId: wsId,
        integrationId: r.integrationId ?? null,
        provider: parsed.data.provider,
        kind: parsed.data.kind,
        externalId: r.externalId,
        title: r.title,
        url: r.url,
        metadata: r.metadata ?? {},
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          integrationResource.workspaceId,
          integrationResource.provider,
          integrationResource.externalId,
        ],
        set: {
          title: r.title,
          url: r.url,
          metadata: r.metadata ?? {},
          integrationId: r.integrationId ?? null,
          lastSyncedAt: new Date(),
        },
      })
      .returning();
    resourceId = resRow?.id ?? null;
  }

  try {
    const [link] = await db
      .insert(projectLink)
      .values({
        workspaceId: wsId,
        projectId: parsed.data.projectId,
        resourceId,
        provider: parsed.data.provider,
        kind: parsed.data.kind,
        url: parsed.data.url,
        title: parsed.data.title,
        metadata: parsed.data.metadata ?? {},
        addedBy: session.user.id,
      })
      .returning();

    await db.insert(timelineEvent).values({
      workspaceId: wsId,
      userId: session.user.id,
      projectId: parsed.data.projectId,
      kind: 'project.link_added',
      title: `Linked ${parsed.data.kind}: ${parsed.data.title}`,
      payload: {
        linkId: link!.id,
        provider: parsed.data.provider,
        kind: parsed.data.kind,
        url: parsed.data.url,
      },
      importance: 0.5,
    });

    revalidatePath('/projects');
    revalidatePath(`/projects/${parsed.data.projectId}`);

    // GitHub repo? Kick off memory seeding (README + commits + issues).
    if (
      parsed.data.provider === 'github' &&
      parsed.data.kind === 'repo' &&
      parsed.data.resource?.integrationId
    ) {
      await inngest
        .send({
          name: 'github/repo.linked',
          data: {
            workspaceId: wsId,
            userId: session.user.id,
            projectId: parsed.data.projectId,
            integrationId: parsed.data.resource.integrationId,
            repoFullName: parsed.data.resource.externalId,
            repoUrl: parsed.data.url,
          },
        })
        .catch(() => {});

      // Also kick a stats sync so the project page lights up immediately.
      if (resourceId) {
        await inngest
          .send({
            name: 'github/stats.sync.repo',
            data: {
              workspaceId: wsId,
              integrationId: parsed.data.resource.integrationId,
              resourceId,
              repoFullName: parsed.data.resource.externalId,
              reason: 'link',
            },
          })
          .catch(() => {});
      }

      // Auto-install a webhook so we get real-time push / PR / issue events
      // (and the broadest event taxonomy we can consume — see
      // ensureRepoWebhook). Skipped silently when no public URL is set.
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.WEBHOOK_PUBLIC_URL ?? null;
      if (baseUrl) {
        await inngest
          .send({
            name: 'github/repo.webhook.ensure',
            data: {
              workspaceId: wsId,
              integrationId: parsed.data.resource.integrationId,
              repoFullName: parsed.data.resource.externalId,
              webhookUrl: `${baseUrl.replace(/\/$/, '')}/api/webhooks/github`,
            },
          })
          .catch(() => {});
      }
    }

    return { ok: true as const, id: link!.id };
  } catch (err) {
    if (err instanceof Error && err.message.toLowerCase().includes('unique'))
      return { ok: false as const, error: 'Already linked' };
    throw err;
  }
}

export async function removeProjectLinkAction(linkId: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectLink)
    .where(and(eq(projectLink.id, linkId), eq(projectLink.workspaceId, wsId)))
    .limit(1);
  if (!row) return { ok: false as const, error: 'Not found' };
  await db
    .delete(projectLink)
    .where(and(eq(projectLink.id, linkId), eq(projectLink.workspaceId, wsId)));
  revalidatePath('/projects');
  revalidatePath(`/projects/${row.projectId}`);
  return { ok: true as const };
}

export async function removeProjectLinkByUrlAction(input: { projectId: string; url: string }) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;
  const db = getDb();
  const [row] = await db
    .select()
    .from(projectLink)
    .where(
      and(
        eq(projectLink.workspaceId, wsId),
        eq(projectLink.projectId, input.projectId),
        eq(projectLink.url, input.url),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: 'Link not found' };
  await db
    .delete(projectLink)
    .where(and(eq(projectLink.id, row.id), eq(projectLink.workspaceId, wsId)));
  revalidatePath('/projects');
  revalidatePath(`/projects/${input.projectId}`);
  return { ok: true as const };
}

/**
 * Manually re-sync every linked GitHub repo for a project. Fans out one
 * `github/stats.sync.repo` event per repo. Useful when the snapshot
 * looks stale (e.g. webhook was disabled or `NEXT_PUBLIC_APP_URL` was
 * unset when the link was added).
 */
export async function reindexProjectGithubLinksAction(projectId: string) {
  const session = await auth();
  if (!session) return { ok: false as const, error: 'Unauthenticated' };
  const wsId = session.user.workspaceId;
  if (!(await ownedProject(wsId, projectId)))
    return { ok: false as const, error: 'Project not found' };
  const db = getDb();
  const rows = await db
    .select({
      resourceId: integrationResource.id,
      integrationId: integrationResource.integrationId,
      externalId: integrationResource.externalId,
    })
    .from(projectLink)
    .innerJoin(
      integrationResource,
      and(
        eq(projectLink.resourceId, integrationResource.id),
        eq(projectLink.workspaceId, integrationResource.workspaceId),
      ),
    )
    .where(
      and(
        eq(projectLink.workspaceId, wsId),
        eq(projectLink.projectId, projectId),
        eq(projectLink.provider, 'github'),
        eq(projectLink.kind, 'repo'),
      ),
    );

  let fired = 0;
  for (const r of rows) {
    if (!r.integrationId) continue;
    await inngest
      .send({
        name: 'github/stats.sync.repo',
        data: {
          workspaceId: wsId,
          integrationId: r.integrationId,
          resourceId: r.resourceId,
          repoFullName: r.externalId,
          reason: 'manual-reindex',
        },
      })
      .catch(() => {});
    fired += 1;
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true as const, fired };
}
