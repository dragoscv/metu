import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Page, PageHeader } from '@metu/ui';
import { getMetuOverviewAction, getRecentAgentActivityAction } from '@/app/actions/metu';
import { MetuDashboard } from '@/components/metu/metu-dashboard';

export default async function MetuPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [overview, activity] = await Promise.all([
    getMetuOverviewAction(),
    getRecentAgentActivityAction(40),
  ]);

  if (!overview.ok) {
    return (
      <Page>
        <PageHeader title="METU" description={`Failed to load: ${overview.error}`} />
      </Page>
    );
  }

  return (
    <Page>
      <MetuDashboard overview={overview.data} activity={activity.ok ? activity.data : []} />
    </Page>
  );
}
