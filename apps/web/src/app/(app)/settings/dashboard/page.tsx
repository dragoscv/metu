import { redirect } from 'next/navigation';
import { auth } from '@metu/auth';
import { Page, PageHeader } from '@metu/ui';
import { getDashboardPrefsAction } from '@/app/actions/dashboard-prefs';
import { DashboardPrefsEditor } from '@/components/dashboard/observatory/dashboard-prefs-editor';

export const metadata = { title: 'Dashboard customization · metu' };

export default async function DashboardSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const prefs = await getDashboardPrefsAction();

  return (
    <Page className="space-y-6">
      <PageHeader
        eyebrow={
          <span className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">
            Settings
          </span>
        }
        title="Customize your dashboard"
        description="Pick a heartbeat metaphor, decide which streams matter, and tune the motion. Your changes preview live."
      />
      <DashboardPrefsEditor initial={prefs} />
    </Page>
  );
}
