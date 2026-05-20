/**
 * /focus — the legacy "single focus" view.
 * Its content used to live inside `/dashboard?tab=now`. Promoted to its
 * own route now that the Observatory owns the dashboard.
 */
import { redirect } from 'next/navigation';
import { auth } from '@metu/auth';
import { focus } from '@metu/core';
import { listProjects, listOpenTasks, listBlockedTasks } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { NowTab } from '@/components/dashboard/now-tab';
import { RecomputeFocusButton } from '@/components/recompute-focus';

export const metadata = { title: 'Focus · metu' };

export default async function FocusPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { workspaceId } = session.user;

  const [latestFocus, projects, openTasks, blocked] = await Promise.all([
    focus.getLatestFocus(workspaceId, session.user.id),
    listProjects(workspaceId),
    listOpenTasks(workspaceId),
    listBlockedTasks(workspaceId),
  ]);

  const ignoredIds = (latestFocus?.ignoredProjectIds as string[]) ?? [];
  const nowTask = openTasks.find((t) => t.id === latestFocus?.nowTaskId) ?? null;
  const nextIds = (latestFocus?.nextTaskIds as string[]) ?? [];
  const nextTasks = nextIds.map((id) => openTasks.find((t) => t.id === id)).filter(Boolean);
  const ignoredProjects = projects.filter((p) => ignoredIds.includes(p.id));
  const momentumProjects = projects.filter((p) => !ignoredIds.includes(p.id)).slice(0, 6);

  return (
    <Page className="space-y-8">
      <PageHeader
        eyebrow={
          <span className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Focus engine
          </span>
        }
        title="Your single next move"
        description="The Conductor narrows the world to one task. Recompute when you finish or get unstuck."
        actions={<RecomputeFocusButton />}
      />
      <NowTab
        latestFocus={latestFocus}
        nowTask={nowTask}
        nextTasks={nextTasks}
        ignoredProjects={ignoredProjects}
        momentumProjects={momentumProjects}
        blocked={blocked}
      />
    </Page>
  );
}
