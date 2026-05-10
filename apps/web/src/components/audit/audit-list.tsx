'use client';
/**
 * Tool-call list with expandable detail rows. Each row shows tool, status,
 * source (conversation or agent run), latency, and cost. Clicking a row
 * reveals JSON args + result + error in a collapsible panel.
 *
 * For `awaiting_approval` rows, an inline Approve/Reject panel is rendered
 * inside the expanded panel so reviewers don't have to hop to the detail
 * page. `success` rows with an `undoPayload` get an inline Undo button.
 *
 * Pure client-side expand/collapse — no fetch on click; the page already
 * sends the truncated args/result with the initial payload.
 */
import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hourglass,
  Loader2,
  ShieldAlert,
  Undo2,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Card } from '@metu/ui';
import {
  approveToolCallAction,
  rejectToolCallAction,
  undoToolCallAction,
} from '@/app/actions/conductor';

export interface AuditItem {
  id: string;
  tool: string;
  status: string;
  aclMode: string | null;
  error: string | null;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  requestedAt: string;
  decidedAt: string | null;
  finishedAt: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  agentRunId: string | null;
  agentRunKind: string | null;
  args: unknown;
  result: unknown;
  hasUndoPayload: boolean;
}

interface Props {
  items: AuditItem[];
  hasMore: boolean;
}

const STATUS_VISUAL: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  success: { icon: CheckCircle2, cls: 'text-[var(--color-success)]', label: 'Success' },
  failed: { icon: XCircle, cls: 'text-[var(--color-danger)]', label: 'Failed' },
  rejected: { icon: ShieldAlert, cls: 'text-[var(--color-danger)]', label: 'Rejected' },
  awaiting_approval: {
    icon: Hourglass,
    cls: 'text-[var(--color-warning)]',
    label: 'Awaiting',
  },
  approved: { icon: CheckCircle2, cls: 'text-[var(--color-info,#3b82f6)]', label: 'Approved' },
  pending: { icon: Clock, cls: 'text-[var(--color-fg-subtle)]', label: 'Pending' },
  running: { icon: Loader2, cls: 'text-[var(--color-brand)] animate-spin', label: 'Running' },
  undone: { icon: Undo2, cls: 'text-[var(--color-fg-subtle)]', label: 'Undone' },
  cancelled: { icon: XCircle, cls: 'text-[var(--color-fg-subtle)]', label: 'Cancelled' },
};

function relative(iso: string): string {
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86_400) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86_400)}d`;
}

function durationMs(start: string, end: string | null): string | null {
  if (!end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function AuditList({ items, hasMore }: Props) {
  if (items.length === 0) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-fg-subtle)]">No tool calls match these filters.</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <AuditRow key={item.id} item={item} />
        ))}
      </ul>
      {hasMore ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3 text-center text-[11px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Showing the most recent results · refine filters to drill in
        </div>
      ) : null}
    </Card>
  );
}

function AuditRow({ item }: { item: AuditItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const visual = STATUS_VISUAL[item.status] ?? STATUS_VISUAL.pending!;
  const Icon = visual.icon;
  const dur = durationMs(item.requestedAt, item.finishedAt);
  const cost = item.actualCostUsd ?? item.estimatedCostUsd;

  const argsJson = useMemo(() => safeStringify(item.args), [item.args]);
  const resultJson = useMemo(() => safeStringify(item.result), [item.result]);

  const showApproval = item.status === 'awaiting_approval';
  const showUndo = item.status === 'success' && item.hasUndoPayload;

  function approve() {
    startTransition(async () => {
      const r = await approveToolCallAction(item.id);
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
      const r = await rejectToolCallAction(item.id, reason || undefined);
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
      const r = await undoToolCallAction(item.id);
      if (!r.ok) {
        toast.error(`Undo failed: ${r.error}`);
        return;
      }
      toast.success('Tool call undone');
      router.refresh();
    });
  }

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-bg-elevated)]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 shrink-0 text-[var(--color-fg-subtle)] transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          />
          <Icon className={`h-4 w-4 shrink-0 ${visual.cls}`} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm">
              <span className="truncate font-mono text-[var(--color-fg)]">{item.tool}</span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                {visual.label}
              </span>
              {item.aclMode ? (
                <span className="rounded-full bg-[var(--color-bg-card)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  {item.aclMode}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-fg-subtle)]">
              <span>{relative(item.requestedAt)}</span>
              {dur ? <span>· {dur}</span> : null}
              {cost && cost > 0 ? <span>· ${cost.toFixed(4)}</span> : null}
              {item.conversationId ? (
                <span className="truncate">· {item.conversationTitle || 'conversation'}</span>
              ) : item.agentRunKind ? (
                <span>· {item.agentRunKind}</span>
              ) : null}
            </div>
          </div>
          {item.error && !open && !showApproval && !showUndo ? (
            <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--color-danger)]">
              <AlertTriangle className="h-3 w-3" />
              error
            </span>
          ) : null}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {showApproval && !open ? (
            <>
              <Button size="sm" onClick={approve} disabled={pending}>
                <Check className="h-3 w-3" />
                Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={reject} disabled={pending}>
                <X className="h-3 w-3" />
                Reject
              </Button>
            </>
          ) : null}
          {showUndo && !open ? (
            <Button size="sm" variant="ghost" onClick={undo} disabled={pending}>
              <Undo2 className="h-3 w-3" />
              Undo
            </Button>
          ) : null}
          {item.conversationId ? (
            <Link
              href={`/chat?id=${item.conversationId}`}
              className="text-[11px] text-[var(--color-fg-subtle)] hover:underline"
              title="Open the conversation that triggered this tool call"
            >
              chat
            </Link>
          ) : null}
          <Link
            href={`/audit/${item.id}`}
            className="text-[11px] text-[var(--color-fg-subtle)] hover:underline"
          >
            Open →
          </Link>
        </div>
      </div>
      {open ? (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3">
          {showApproval ? (
            <div className="border-[var(--color-warning)]/40 bg-[var(--color-warning-bg)]/20 mb-3 flex flex-col gap-2 rounded border p-3">
              <p className="text-xs text-[var(--color-fg)]">
                Awaiting approval — review the arguments below before deciding.
              </p>
              <input
                type="text"
                placeholder="Optional reason for rejection…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={pending}
                className="h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 text-xs"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={approve} disabled={pending}>
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button size="sm" variant="ghost" onClick={reject} disabled={pending}>
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>
            </div>
          ) : null}
          {showUndo ? (
            <div className="mb-3 flex items-center justify-between gap-3 rounded border border-[var(--color-border)] p-3">
              <p className="text-xs text-[var(--color-fg-subtle)]">
                This call has an undo payload. You can roll it back.
              </p>
              <Button size="sm" variant="ghost" onClick={undo} disabled={pending}>
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </Button>
            </div>
          ) : null}
          <DetailBlock label="Arguments" body={argsJson} />
          {item.result !== null ? <DetailBlock label="Result" body={resultJson} /> : null}
          {item.error ? <DetailBlock label="Error" body={item.error} tone="danger" mono /> : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-fg-subtle)]">
            <span>requested {new Date(item.requestedAt).toLocaleString()}</span>
            {item.decidedAt ? (
              <span>· decided {new Date(item.decidedAt).toLocaleString()}</span>
            ) : null}
            {item.finishedAt ? (
              <span>· finished {new Date(item.finishedAt).toLocaleString()}</span>
            ) : null}
            <span className="font-mono">· {item.id}</span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function DetailBlock({
  label,
  body,
  tone = 'default',
  mono = true,
}: {
  label: string;
  body: string;
  tone?: 'default' | 'danger';
  mono?: boolean;
}) {
  const toneCls =
    tone === 'danger'
      ? 'border-[var(--color-danger)]/40 text-[var(--color-danger)]'
      : 'border-[var(--color-border)] text-[var(--color-fg)]';
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {label}
      </div>
      <pre
        className={`mt-1 max-h-56 overflow-auto rounded border px-2 py-1.5 text-[11px] leading-relaxed ${toneCls} ${
          mono ? 'font-mono' : ''
        }`}
      >
        {body}
      </pre>
    </div>
  );
}

function safeStringify(v: unknown): string {
  if (v == null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
