import { Loader2 } from 'lucide-react';

export default function AppGroupLoading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center p-6">
      <div className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    </div>
  );
}
