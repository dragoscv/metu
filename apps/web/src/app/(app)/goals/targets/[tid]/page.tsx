import { auth } from '@metu/auth';
import { getTargetById, listTargetValues } from '@metu/db/queries';
import { Badge, Page, PageHeader } from '@metu/ui';
import { Pencil } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { TargetDetailClient } from '@/components/goals/target-detail-client';

interface PageProps {
  params: Promise<{ tid: string }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  achieved: 'neutral',
  dropped: 'danger',
};

export default async function TargetDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { tid } = await params;
  const wsId = session.user.workspaceId;
  const t = await getTargetById(wsId, tid);
  if (!t) notFound();
  const values = await listTargetValues(wsId, tid, 200);

  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader
        back={{ href: '/goals#targets', label: 'Targets' }}
        title={t.title}
        eyebrow={
          <Badge variant={STATUS_TONE[t.status] ?? 'neutral'} size="sm">
            {t.status}
          </Badge>
        }
        description={
          <span className="text-xs text-[var(--color-fg-subtle)]">
            {t.period} · {t.aggregation} · {t.unit || 'no unit'}
          </span>
        }
        actions={
          <Link
            href={`/goals/targets/${tid}/edit`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </Link>
        }
      />

      <TargetDetailClient
        target={{
          id: t.id,
          unit: t.unit,
          targetValue: t.targetValue,
          currentValue: t.currentValue,
          aggregation: t.aggregation,
        }}
        values={values.map((v) => ({
          id: v.id,
          value: v.value,
          source: v.source,
          note: v.note,
          recordedAt: v.recordedAt.toISOString(),
        }))}
      />
    </Page>
  );
}
