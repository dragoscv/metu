import { auth } from '@metu/auth';
import { computeStreakStats, listEntriesForStreaks, listStreaks } from '@metu/db/queries';
import { EmptyState, Page, PageHeader, PageSection } from '@metu/ui';
import { Flame } from 'lucide-react';
import { redirect } from 'next/navigation';
import { StreakCard, type StreakRow } from '@/components/streaks/streak-card';
import { StreakComposer } from '@/components/streaks/streak-composer';

export default async function StreaksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const sp = await searchParams;
  const includeArchived = sp.archived === '1';

  const wsId = session.user.workspaceId;
  const rows = await listStreaks({ workspaceId: wsId, includeArchived });
  const ids = rows.map((r) => r.id);
  const allEntries = await listEntriesForStreaks(wsId, ids, 90);

  const entriesByStreak = new Map<
    string,
    { day: string; value: number; failed: boolean; note: string | null }[]
  >();
  for (const e of allEntries) {
    const k = e.streakId;
    const list = entriesByStreak.get(k) ?? [];
    list.push({ day: e.day, value: e.value, failed: e.failed, note: e.note });
    entriesByStreak.set(k, list);
  }

  const streaksForUi: {
    streak: StreakRow;
    entries: { day: string; value: number; failed: boolean; note: string | null }[];
    stats: ReturnType<typeof computeStreakStats>;
  }[] = rows.map((r) => {
    const entries = entriesByStreak.get(r.id) ?? [];
    return {
      streak: {
        id: r.id,
        name: r.name,
        body: r.body,
        kind: r.kind,
        target: r.target,
        unit: r.unit,
        color: r.color,
        weight: r.weight,
        startedAt: r.startedAt.toISOString(),
        archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
      },
      entries,
      stats: computeStreakStats(r.kind, entries, r.startedAt),
    };
  });

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
            <Flame className="h-3 w-3" /> behavior loop
          </span>
        }
        title="Streaks"
        description="Daily-cadence behaviors. Build chains. Watch them break. Try again tomorrow."
        actions={<StreakComposer />}
      />

      <PageSection>
        {streaksForUi.length === 0 ? (
          <EmptyState
            icon={<Flame className="h-10 w-10 text-[var(--color-muted)]" aria-hidden />}
            title="No streaks yet"
            description="Start one. The hardest day is day one."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {streaksForUi.map(({ streak, entries, stats }) => (
              <StreakCard key={streak.id} streak={streak} entries={entries} stats={stats} />
            ))}
          </div>
        )}
      </PageSection>
    </Page>
  );
}
