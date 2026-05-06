import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card } from '@metu/ui';
import { MemorySearch } from '@/components/memory-search';

export default async function MemoryPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          Ask anything you ever captured, decided, or shipped.
        </p>
      </header>
      <Card>
        <MemorySearch />
      </Card>
    </div>
  );
}
