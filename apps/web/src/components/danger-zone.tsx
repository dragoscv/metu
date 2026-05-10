'use client';
/**
 * Danger zone client-side controls.
 *
 * Two destructive surfaces in one card:
 * 1. Export — GET /api/workspace/export. Browser handles the download
 *    via a hidden anchor; no JS state machine needed beyond a
 *    "starting…" toast.
 * 2. Delete — POST /api/workspace/delete with `confirm=<workspaceId>`,
 *    gated behind a Dialog that requires the user to type the id.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, Card, CardTitle, Dialog, DialogFooter } from '@metu/ui';

export function DangerZone({
  workspaceId,
  workspaceName,
  isOwner,
}: {
  workspaceId: string;
  workspaceName: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const onExport = () => {
    toast.message('Preparing export…', {
      description: 'A JSON download will start when ready.',
    });
    // Trigger the browser download. The route streams a JSON blob with
    // Content-Disposition: attachment.
    window.location.href = '/api/workspace/export';
  };

  const onDelete = () => {
    if (typed !== workspaceId) {
      toast.error('Workspace id does not match.');
      return;
    }
    start(async () => {
      const res = await fetch('/api/workspace/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: workspaceId }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? 'Delete failed');
        return;
      }
      toast.success('Workspace deleted.');
      setConfirmOpen(false);
      router.push('/');
      router.refresh();
    });
  };

  return (
    <Card className="border-rose-500/30 bg-rose-500/[0.04]">
      <CardTitle>Danger zone</CardTitle>
      <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
        Workspace <span className="font-mono">{workspaceName}</span> ·{' '}
        <span className="font-mono text-[10px]">{workspaceId}</span>
      </p>

      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-fg)]">Export everything</div>
            <div className="text-xs text-[var(--color-fg-subtle)]">
              JSON snapshot of captures, projects, goals, memory, timeline. Lives only in your
              browser download.
            </div>
          </div>
          <Button variant="outline" onClick={onExport}>
            Export JSON
          </Button>
        </div>

        <hr className="border-[var(--color-border)]/60" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--color-fg)]">Delete workspace</div>
            <div className="text-xs text-[var(--color-fg-subtle)]">
              {isOwner
                ? 'Permanent. Cascades to every row tagged to this workspace.'
                : 'Only owners can delete a workspace.'}
            </div>
          </div>
          <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={!isOwner}>
            Delete…
          </Button>
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!pending) {
            setConfirmOpen(false);
            setTyped('');
          }
        }}
        title="Delete this workspace?"
        description="This is irreversible. All members lose access immediately. Captures, projects, goals, memory, timeline events and audit history are permanently removed."
        dismissOnBackdrop={!pending}
      >
        <p className="text-[var(--color-fg-muted)]">To confirm, type the workspace id below:</p>
        <code className="mt-2 block break-all rounded-[var(--radius)] bg-[var(--color-bg-elevated)] px-3 py-2 font-mono text-xs">
          {workspaceId}
        </code>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoFocus
          placeholder="Paste id"
          className="mt-3 w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-xs"
        />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setConfirmOpen(false);
              setTyped('');
            }}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={onDelete} disabled={pending || typed !== workspaceId}>
            {pending ? 'Deleting…' : 'Delete forever'}
          </Button>
        </DialogFooter>
      </Dialog>
    </Card>
  );
}
