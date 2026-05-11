'use server';
/**
 * Demo data seed — one-shot helper for the onboarding checklist so a
 * fresh workspace has something to click around. Idempotent guard:
 * refuses to seed once any project exists.
 */
import { revalidatePath } from 'next/cache';
import { count, eq } from 'drizzle-orm';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { capture, project, task } from '@metu/db/schema';

export async function seedDemoDataAction(): Promise<
  { ok: true; projectId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'Unauthenticated' };
  const db = getDb();
  const workspaceId = session.user.workspaceId;

  const [existing] = await db
    .select({ n: count() })
    .from(project)
    .where(eq(project.workspaceId, workspaceId));
  if ((existing?.n ?? 0) > 0) {
    return { ok: false, error: 'Workspace already has projects — refusing to seed.' };
  }

  const [proj] = await db
    .insert(project)
    .values({
      workspaceId,
      name: 'metu — getting started',
      slug: 'getting-started',
      summary: 'A sample project so you can see how tasks, captures, and recall hang together.',
      status: 'active',
    })
    .returning();
  if (!proj) return { ok: false, error: 'Failed to create demo project' };

  await db.insert(task).values([
    {
      workspaceId,
      projectId: proj.id,
      title: 'Connect a device (companion or mobile)',
      status: 'next',
      kind: 'shallow',
    },
    {
      workspaceId,
      projectId: proj.id,
      title: 'Capture your first thought in the brain dump',
      status: 'next',
      kind: 'shallow',
    },
    {
      workspaceId,
      projectId: proj.id,
      title: 'Set a goal so the Conductor knows what to optimise for',
      status: 'inbox',
      kind: 'shallow',
    },
  ]);

  await db.insert(capture).values({
    workspaceId,
    userId: session.user.id,
    projectId: proj.id,
    kind: 'text',
    content: 'Welcome to metu! This is a sample capture — replace it with your own.',
    source: 'web',
  });

  revalidatePath('/dashboard');
  revalidatePath('/projects');
  return { ok: true, projectId: proj.id };
}
