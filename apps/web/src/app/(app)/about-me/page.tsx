import { auth } from '@metu/auth';
import { Page, PageHeader } from '@metu/ui';
import { Sparkles } from 'lucide-react';
import { redirect } from 'next/navigation';
import { ProfileWizard } from '@/components/profile-wizard/profile-wizard';
import { getProfileWizardStateAction } from '@/app/actions/profile-wizard';

export const dynamic = 'force-dynamic';

export default async function AboutMePage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const state = await getProfileWizardStateAction();
  const facts = state.ok ? state.facts : [];
  const factCount = state.ok ? state.factCount : 0;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2.5 py-0.5 text-xs text-[var(--color-fg-muted)]">
            <Sparkles className="h-3 w-3 text-[var(--color-brand)]" />
            Always learning
          </span>
        }
        title="About you"
        description="The more I know about how you work, what you care about, and where you're headed — the better I can help. Drop in any time."
      />
      <ProfileWizard
        initialFacts={facts}
        initialFactCount={factCount}
        userName={session.user.name ?? null}
      />
    </Page>
  );
}
