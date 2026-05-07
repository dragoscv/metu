import { Card, Skeleton } from '@metu/ui';

export function ListPageSkeleton({
  rows = 6,
  withToolbar = true,
}: {
  rows?: number;
  withToolbar?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      {withToolbar && (
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
        </div>
      )}
      <ul className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <li
            key={i}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="h-7 w-7 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/5" />
                <Skeleton className="h-3 w-2/5 opacity-60" />
              </div>
              <Skeleton className="h-3.5 w-12" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GridPageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <Card key={i}>
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-full opacity-60" />
              <Skeleton className="h-3 w-4/5 opacity-60" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-5 w-20" />
              </div>
              <Skeleton className="mt-3 h-1.5 w-full" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Skeleton className="h-3 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Card>
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </Card>
      </div>
    </div>
  );
}
