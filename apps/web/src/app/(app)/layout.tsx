import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, desc, eq, ne } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { conversation } from '@metu/db/schema';
import { PageTransition } from '@metu/ui';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandBar } from '@/components/command-bar';
import { ConductorDrawer } from '@/components/conductor-drawer';
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts';
import { QuickCapture } from '@/components/quick-capture';
import { SidebarProvider } from '@/components/sidebar/sidebar-provider';
import { MobileTopbar } from '@/components/sidebar/mobile-topbar';

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

  return (
    <SidebarProvider>
      <div className="flex min-h-screen">
        <AppSidebar user={session.user} metuConversations={metuConversations} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopbar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
              <PageTransition>{children}</PageTransition>
            </div>
          </main>
        </div>
        <CommandBar />
        <ConductorDrawer />
        <QuickCapture />
        <KeyboardShortcuts />
      </div>
    </SidebarProvider>
  );
}
