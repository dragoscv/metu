import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { agentPolicy } from '@metu/db/schema';
import { Page, PageHeader } from '@metu/ui';
import { Sparkles } from 'lucide-react';
import { AutonomyPresetWizard } from '@/components/autonomy-preset-wizard';

export default async function AgentOnboardingPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const db = getDb();
  const [policy] = await db
    .select({ defaultMode: agentPolicy.defaultMode })
    .from(agentPolicy)
    .where(eq(agentPolicy.workspaceId, session.user.workspaceId))
    .limit(1);

  const current =
    policy?.defaultMode === 'observe'
      ? 'observe'
      : policy?.defaultMode === 'auto_with_undo' || policy?.defaultMode === 'autopilot'
        ? 'autopilot'
        : 'ask';

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Onboarding
          </span>
        }
        title="Pick your autonomy"
        description="One choice now, change anytime in Settings → Agents."
      />
      <AutonomyPresetWizard initial={current} />
    </Page>
  );
}
