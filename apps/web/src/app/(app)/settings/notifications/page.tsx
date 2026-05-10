import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Page, PageHeader } from '@metu/ui';
import { getNotificationPrefsAction } from '@/app/actions/notification-prefs';
import { NotificationPrefsForm } from '@/components/notification-prefs-form';

export default async function NotificationsSettingsPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const prefs = await getNotificationPrefsAction();
  return (
    <Page>
      <PageHeader
        eyebrow="Settings"
        title="Notifications"
        description="Quiet hours and per-channel mutes for conductor + integration alerts."
      />
      <NotificationPrefsForm initial={prefs} />
    </Page>
  );
}
