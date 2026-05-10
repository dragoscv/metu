import { Page, PageHeader, PageSection, Skeleton } from '@metu/ui';

export default function Loading() {
  return (
    <Page>
      <PageHeader back={{ href: '/goals', label: 'All goals' }} title="Loading…" />
      <PageSection title="Snapshot">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </PageSection>
      <PageSection title="Milestones">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </PageSection>
    </Page>
  );
}
