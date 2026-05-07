import { auth } from '@metu/auth';
import { Page, PageHeader } from '@metu/ui';
import { redirect } from 'next/navigation';
import { ProjectStarter } from '@/components/projects/project-starter';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  return (
    <Page className="mx-auto max-w-2xl">
      <PageHeader
        size="sm"
        back={{ href: '/projects', label: 'Projects' }}
        title="New project"
        description="Most projects start from a Git repo — search, create, or paste a URL. Or start blank and link things later."
      />
      <ProjectStarter />
    </Page>
  );
}
