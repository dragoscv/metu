import { auth } from '@metu/auth';
import { listProjects } from '@metu/db/queries';
import { Page, PageHeader } from '@metu/ui';
import { redirect } from 'next/navigation';
import { listGithubAccountsAction } from '@/app/actions/github';
import { GithubBrowser } from '@/components/integrations/github-browser';

export const dynamic = 'force-dynamic';

export default async function GithubIntegrationPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [accountsRes, projects] = await Promise.all([
    listGithubAccountsAction(),
    listProjects(session.user.workspaceId),
  ]);

  const accounts = accountsRes.ok ? accountsRes.accounts : [];
  const projectOptions = projects
    .filter((p) => p.status !== 'archived' && p.status !== 'killed')
    .map((p) => ({ id: p.id, name: p.name, slug: p.slug }));

  return (
    <Page>
      <PageHeader
        size="sm"
        back={{ href: '/integrations', label: 'Integrations' }}
        title="GitHub"
        description="Browse repositories from your connected GitHub accounts and assign them to projects. Linked repos route push, PR, and issue events into the project timeline."
      />
      <GithubBrowser accounts={accounts} projects={projectOptions} />
    </Page>
  );
}
