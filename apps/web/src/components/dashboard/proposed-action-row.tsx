'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button } from '@metu/ui';
import { Check, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { approveToolCallAction, rejectToolCallAction } from '@/app/actions/conductor';

function summarizeArgs(args: Record<string, unknown> | null): string {
  if (!args) return '';
  const entries = Object.entries(args).slice(0, 3);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      const trimmed = s.length > 60 ? s.slice(0, 60) + '…' : s;
      return `${k}=${trimmed}`;
    })
    .join(' · ');
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

export function ProposedActionRow({
  id,
  tool,
  args,
  estimatedCostUsd,
  requestedAt,
}: {
  id: string;
  tool: string;
  args: Record<string, unknown> | null;
  estimatedCostUsd: string | number | null;
  requestedAt: string;
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null);
  const router = useRouter();

  if (done) {
    return (
      <li className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-fg-subtle)]">
        <span>
          {tool} — {done === 'approved' ? 'approved' : 'rejected'}
        </span>
      </li>
    );
  }

  function handle(action: 'approve' | 'reject') {
    start(async () => {
      const r =
        action === 'approve' ? await approveToolCallAction(id) : await rejectToolCallAction(id);
      if (r && 'ok' in r && r.ok) {
        toast.success(action === 'approve' ? `${tool} approved` : `${tool} rejected`);
        setDone(action === 'approve' ? 'approved' : 'rejected');
        router.refresh();
      } else {
        const err = r && 'error' in r ? r.error : 'failed';
        toast.error(err);
      }
    });
  }

  const cost = estimatedCostUsd ? `~$${Number(estimatedCostUsd).toFixed(3)}` : null;
  const summary = summarizeArgs(args);

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{tool}</span>
          <Badge variant="warning">awaiting approval</Badge>
          {cost && <span className="text-xs text-[var(--color-fg-subtle)]">{cost}</span>}
        </div>
        {summary && <p className="mt-1 truncate text-xs text-[var(--color-fg-muted)]">{summary}</p>}
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">{relTime(requestedAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => handle('reject')}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <X className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => handle('approve')}>
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span className="ml-1.5">Approve</span>
        </Button>
      </div>
    </li>
  );
}
