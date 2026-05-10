'use client';
/**
 * Action panel for a single tool call. Shows approve/reject when status
 * is `awaiting_approval`, undo when status is `success` and the row has
 * an `undoPayload`. All other states render nothing — the page falls
 * back to a static read-only view.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@metu/ui';
import {
  approveToolCallAction,
  rejectToolCallAction,
  undoToolCallAction,
} from '@/app/actions/conductor';

interface Props {
  toolCallId: string;
  status: string;
  hasUndoPayload: boolean;
}

export function ToolCallActions({ toolCallId, status, hasUndoPayload }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');

  const showApproval = status === 'awaiting_approval';
  const showUndo = status === 'success' && hasUndoPayload;

  if (!showApproval && !showUndo) return null;

  function approve() {
    startTransition(async () => {
      const r = await approveToolCallAction(toolCallId);
      if (!r.ok) {
        toast.error(`Approve failed: ${r.error ?? r.status ?? 'unknown'}`);
        return;
      }
      toast.success('Tool call approved');
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const r = await rejectToolCallAction(toolCallId, reason || undefined);
      if (!r.ok) {
        toast.error('Reject failed');
        return;
      }
      toast.success('Tool call rejected');
      setReason('');
      router.refresh();
    });
  }

  function undo() {
    startTransition(async () => {
      const r = await undoToolCallAction(toolCallId);
      if (!r.ok) {
        toast.error(`Undo failed: ${r.error}`);
        return;
      }
      toast.success('Tool call undone');
      router.refresh();
    });
  }

  return (
    <Card>
      {showApproval ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-fg)]">
            This tool call is awaiting your approval.
          </p>
          <input
            type="text"
            placeholder="Optional reason for rejection…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={approve} disabled={pending}>
              <Check className="h-4 w-4" />
              Approve
            </Button>
            <Button variant="ghost" onClick={reject} disabled={pending}>
              <X className="h-4 w-4" />
              Reject
            </Button>
          </div>
        </div>
      ) : null}
      {showUndo ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-fg-subtle)]">
            This tool call has an undo payload. You can roll it back.
          </p>
          <Button variant="ghost" onClick={undo} disabled={pending}>
            <Undo2 className="h-4 w-4" />
            Undo
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
