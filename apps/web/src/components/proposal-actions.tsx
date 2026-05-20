'use client';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@metu/ui';
import { respondToProposalAction } from '@/app/actions/proposals';
import { approveToolCallAction, rejectToolCallAction } from '@/app/actions/conductor';

interface Action {
  id: string;
  label: string;
  kind: 'approve' | 'reject' | 'open' | 'custom';
  toolCallId?: string;
  href?: string;
}

export function ProposalActions({
  notificationId,
  actions,
  hasToolProposal,
  toolCallId,
}: {
  notificationId: string;
  actions: Action[];
  /** Set when notification.metadata has a `toolProposal` (Conductor reactor flow). */
  hasToolProposal: boolean;
  /**
   * Set when notification.metadata has a `toolCallId` (policy.ts ACL flow —
   * a tool already requested by the agent that needs the user's nod).
   * Mutually exclusive with hasToolProposal in practice.
   */
  toolCallId?: string;
}) {
  const [pending, start] = useTransition();
  if (!hasToolProposal && !toolCallId) return null;
  if (actions.length === 0) return null;

  function decide(decision: 'approve' | 'reject') {
    start(async () => {
      // Pending tool-call (agent already proposed via runTool with mode 'ask')
      if (toolCallId) {
        const r =
          decision === 'approve'
            ? await approveToolCallAction(toolCallId)
            : await rejectToolCallAction(toolCallId);
        if (r.ok) {
          toast.success(decision === 'approve' ? 'Tool approved' : 'Tool rejected');
        } else {
          toast.error(r.error ?? 'Failed');
        }
        return;
      }
      // Inline toolProposal (reactor flow — runs the tool now)
      const r = await respondToProposalAction({ notificationId, decision });
      if (r.ok) {
        toast.success(decision === 'approve' ? 'Proposal approved' : 'Proposal dismissed');
      } else {
        toast.error(r.error ?? 'Failed');
      }
    });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {actions.map((a) => {
        const variant: 'default' | 'ghost' | 'outline' =
          a.kind === 'approve' ? 'default' : a.kind === 'reject' ? 'ghost' : 'outline';
        const onClick =
          a.kind === 'approve'
            ? () => decide('approve')
            : a.kind === 'reject'
              ? () => decide('reject')
              : undefined;
        return (
          <Button
            key={a.id}
            size="sm"
            variant={variant}
            disabled={pending || !onClick}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClick?.();
            }}
          >
            {a.label}
          </Button>
        );
      })}
    </div>
  );
}
