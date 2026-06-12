import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Page, PageHeader } from '@metu/ui';
import { Brain } from 'lucide-react';
import { getMemoryOverviewAction, listRecentMemoriesAction } from '@/app/actions/memory';
import { MemoryWorkspace } from '@/components/memory/memory-workspace';

export default async function MemoryPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [overviewRes, recentRes] = await Promise.all([
    getMemoryOverviewAction(),
    listRecentMemoriesAction({ limit: 20 }),
  ]);

  const overview = overviewRes.ok
    ? overviewRes.overview
    : { total: 0, lastIndexedAt: null, byKind: [] };
  const items = recentRes.ok ? recentRes.items : [];
  const cursor = recentRes.ok ? recentRes.nextCursor : null;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Long-term recall
          </span>
        }
        title="Memory"
        description="Everything you've captured, decided, or shipped — embedded for instant recall."
      />
      <MemoryWorkspace
        initialOverview={overview}
        initialRecent={items}
        initialRecentCursor={cursor}
      />
    </Page>
  );
}
