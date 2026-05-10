'use client';
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogFooter, Button } from '@metu/ui';
import { archiveProjectAction, restoreProjectAction } from '@/app/actions/project';

/**
 * Archive / restore button for the project detail page header.
 *
 * Archive is non-destructive — the project just disappears from the
 * default `/projects` list. The user can still find it by selecting
 * the "Archived" status filter, and one click here puts it back.
 */
export function ProjectArchiveButton({
  projectId,
  status,
}: {
  projectId: string;
  status: 'active' | 'paused' | 'archived' | 'killed';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isArchived = status === 'archived';

  if (isArchived) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await restoreProjectAction(projectId);
            if (r && 'ok' in r && !r.ok) {
              toast.error('Could not restore');
              return;
            }
            toast.success('Project restored');
            router.refresh();
          })
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
      >
        <RotateCcw className="h-4 w-4" />
        {pending ? 'Restoring…' : 'Restore'}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
      >
        <Archive className="h-4 w-4" />
        Archive
      </button>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Archive this project?"
        description="It disappears from the default Projects list and stops contributing to momentum nudges. Restore it any time."
      >
        <p className="text-[var(--color-fg-muted)]">
          Tasks, decisions, captures, and links are preserved as-is. To re-surface, open the
          Projects list and switch the status filter to <strong>Archived</strong>.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              start(async () => {
                const r = await archiveProjectAction(projectId);
                setConfirmOpen(false);
                if (r && 'ok' in r && !r.ok) {
                  toast.error('Could not archive');
                  return;
                }
                toast.success('Archived');
                router.refresh();
              })
            }
            disabled={pending}
          >
            {pending ? 'Archiving…' : 'Archive'}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
