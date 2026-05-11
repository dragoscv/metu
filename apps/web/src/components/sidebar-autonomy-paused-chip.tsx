'use client';
/**
 * Sidebar chip for autonomy paused state. One-click Resume sits inline so the
 * user doesn't have to navigate to the dashboard to flip the switch back on.
 */
import { useTransition } from 'react';
import { Loader2, Play } from 'lucide-react';
import { updateAutonomyPolicyAction } from '@/app/actions/autonomy';

export function SidebarAutonomyPausedChip({ collapsed = false }: { collapsed?: boolean }) {
  const [pending, startTransition] = useTransition();

  const resume = () => {
    startTransition(async () => {
      await updateAutonomyPolicyAction({ enabled: true });
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={resume}
        disabled={pending}
        title="Autonomy paused — click to resume"
        className="bg-[var(--color-warning)]/10 hover:bg-[var(--color-warning)]/15 mb-2 flex w-full items-center justify-center rounded-md p-1.5 text-[var(--color-warning)] disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-warning)]" />
        )}
      </button>
    );
  }

  return (
    <div className="bg-[var(--color-warning)]/10 mb-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[11px] text-[var(--color-warning)]">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-warning)]" />
        <span className="font-medium">Autonomy paused</span>
      </span>
      <button
        type="button"
        onClick={resume}
        disabled={pending}
        className="bg-[var(--color-warning)]/20 hover:bg-[var(--color-warning)]/30 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : (
          <Play className="h-2.5 w-2.5" />
        )}
        Resume
      </button>
    </div>
  );
}
