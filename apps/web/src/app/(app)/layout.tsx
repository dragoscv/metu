import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandBar } from '@/components/command-bar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  return (
    <div className="flex min-h-screen">
      <AppSidebar user={session.user} />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
      <CommandBar />
    </div>
  );
}
