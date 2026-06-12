import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy, conversation } from '@metu/db/schema';
import {
  attentionToolCallCount,
  recentTimelineEventCount,
  notificationUnreadCount,
  listIntegrations,
} from '@metu/db/queries';
import { getUserWorkspaces } from '@metu/db/queries';
import { PageTransition } from '@metu/ui';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandBar } from '@/components/command-bar';
import { ConductorDrawer } from '@/components/conductor-drawer';
import { ConductorStrip } from '@/components/conductor-strip';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { QuickCapture } from '@/components/quick-capture';
import { SidebarProvider } from '@/components/sidebar/sidebar-provider';
import { MobileTopbar } from '@/components/sidebar/mobile-topbar';
import { TrialBanner } from '@/components/billing/trial-banner';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const workspaceId = session.user.workspaceId;

  // Ensure the singleton Conductor thread exists so the METU group always has
  // a default destination on first load.
  const [existingConductor] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), eq(conversation.kind, 'conductor')))
    .limit(1);
  if (!existingConductor) {
    await db.insert(conversation).values({
      workspaceId,
      kind: 'conductor',
      status: 'pinned',
      title: 'Conductor',
      summary: 'Your always-on supervisor.',
    });
  }

  const rows = await db
    .select({
      id: conversation.id,
      kind: conversation.kind,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt,
      status: conversation.status,
    })
    .from(conversation)
    .where(and(eq(conversation.workspaceId, workspaceId), ne(conversation.status, 'archived')))
    .orderBy(desc(conversation.lastMessageAt));

  const metuConversations = rows.map((c) => ({
    id: c.id,
    kind: c.kind as 'conductor' | 'side' | 'project' | 'tool',
    title: c.title,
    lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
    status: c.status as 'active' | 'archived' | 'pinned',
  }));

  // Sidebar discoverability: surface fresh activity on the leaves that
  // host it. 24h window is short enough to avoid badge fatigue and
  // long enough that the user notices the day's signals when they open
  // the app in the morning.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [timelineCount, auditAttention, unreadNotifications, workspaces, policyRow, integrations] =
    await Promise.all([
      recentTimelineEventCount(workspaceId, since24h),
      attentionToolCallCount(workspaceId, since24h),
      notificationUnreadCount(workspaceId, session.user.id),
      getUserWorkspaces(session.user.id),
      db
        .select({ enabled: agentPolicy.enabled })
        .from(agentPolicy)
        .where(eq(agentPolicy.workspaceId, workspaceId))
        .limit(1),
      listIntegrations(workspaceId),
    ]);
  const autonomyPaused = policyRow[0] ? !policyRow[0].enabled : false;
  const activeIntegrations = integrations.filter((i) => i.status === 'active').length;
  const sidebarBadges: Record<string, number> = {
    '/timeline': timelineCount,
    '/audit': auditAttention,
    '/notifications': unreadNotifications,
    '/integrations': activeIntegrations,
  };
  const workspaceOptions = workspaces.map((w) => ({
    id: w.workspace.id,
    name: w.workspace.name,
    slug: w.workspace.slug,
  }));

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-[var(--color-bg-elevated)] focus:px-4 focus:py-2 focus:text-sm focus:shadow-lg"
        >
          Skip to content
        </a>
        <AppSidebar
          user={session.user}
          metuConversations={metuConversations}
          badges={sidebarBadges}
          workspaces={workspaceOptions}
          activeWorkspaceId={workspaceId}
          autonomyPaused={autonomyPaused}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopbar />
          <main id="main-content" className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
              <TrialBanner />
              <PageTransition>{children}</PageTransition>
            </div>
          </main>
        </div>
        <CommandBar />
        <ConductorDrawer />
        <ConductorStrip workspaceId={workspaceId} />
        <QuickCapture />
        <KeyboardShortcuts />
      </div>
    </SidebarProvider>
  );
}
