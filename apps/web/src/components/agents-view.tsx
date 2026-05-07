'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  CircleDashed,
  Columns3,
  GitBranch,
  LayoutGrid,
  Table as TableIcon,
  XCircle,
} from 'lucide-react';
import { Card, CardTitle, cn } from '@metu/ui';

export type ViewKind = 'cards' | 'table' | 'kanban' | 'timeline';

export interface AgentRunRow {
  id: string;
  kind: string;
  intent: string;
  providerUsed: string | null;
  modelUsed: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  inputPreview: string | null;
  outputPreview: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ToolCallRow {
  id: string;
  tool: string;
  status: string;
  requestedAt: string;
  finishedAt: string | null;
  aclMode: string | null;
  conversationId: string | null;
}

export interface ThreadRow {
  id: string;
  title: string;
  kind: string;
  status: string;
  lastMessageAt: string | null;
}

const VIEWS: { key: ViewKind; label: string; Icon: typeof LayoutGrid }[] = [
  { key: 'cards', label: 'Cards', Icon: LayoutGrid },
  { key: 'table', label: 'Table', Icon: TableIcon },
  { key: 'kanban', label: 'Kanban', Icon: Columns3 },
  { key: 'timeline', label: 'Timeline', Icon: GitBranch },
];

const STATUS_STYLE: Record<AgentRunRow['status'], { color: string; Icon: typeof CheckCircle2 }> = {
  pending: { color: 'text-[var(--color-fg-muted)]', Icon: CircleDashed },
  running: { color: 'text-[var(--color-warning)]', Icon: Clock },
  success: { color: 'text-[var(--color-success)]', Icon: CheckCircle2 },
  failed: { color: 'text-[var(--color-danger)]', Icon: XCircle },
  cancelled: { color: 'text-[var(--color-fg-subtle)]', Icon: XCircle },
};

export function AgentsView({
  view,
  runs,
  toolCalls,
  threads,
}: {
  view: ViewKind;
  runs: AgentRunRow[];
  toolCalls: ToolCallRow[];
  threads: ThreadRow[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function setView(v: ViewKind) {
    const next = new URLSearchParams(sp);
    next.set('view', v);
    router.push(`/agents?${next.toString()}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs',
                view === v.key
                  ? 'bg-[var(--color-bg-card)] text-[var(--color-fg)]'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              )}
            >
              <v.Icon className="h-3.5 w-3.5" />
              {v.label}
            </button>
          ))}
        </div>
        <div className="text-xs text-[var(--color-fg-subtle)]">
          {runs.length} runs · last 7 days
        </div>
      </div>

      {view === 'cards' && <CardsView runs={runs} threads={threads} />}
      {view === 'table' && <TableView runs={runs} />}
      {view === 'kanban' && <KanbanView runs={runs} />}
      {view === 'timeline' && <TimelineView runs={runs} toolCalls={toolCalls} />}
    </div>
  );
}

function CardsView({ runs, threads }: { runs: AgentRunRow[]; threads: ThreadRow[] }) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <Card>
            <p className="text-sm text-[var(--color-fg-muted)]">No agent activity yet.</p>
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {runs.slice(0, 12).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
          Active threads
        </h2>
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {threads.map((t) => (
            <Link key={t.id} href={`/chat?id=${t.id}`}>
              <Card className="h-full hover:border-[var(--color-brand)]">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="!mt-0 truncate">{t.title}</CardTitle>
                  <span className="text-[10px] uppercase text-[var(--color-fg-subtle)]">
                    {t.kind}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-[var(--color-fg-subtle)]">
                  {t.lastMessageAt
                    ? `Last message ${new Date(t.lastMessageAt).toLocaleString()}`
                    : 'No messages yet'}
                </p>
              </Card>
            </Link>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RunCard({ run }: { run: AgentRunRow }) {
  const s = STATUS_STYLE[run.status];
  const SI = s.Icon;
  const dur =
    run.finishedAt && run.startedAt
      ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
      : null;
  return (
    <li>
      <Card className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-[var(--color-fg-muted)]">{run.kind}</span>
          <span className={cn('inline-flex items-center gap-1 text-xs', s.color)}>
            <SI className="h-3 w-3" /> {run.status}
          </span>
        </div>
        <p className="line-clamp-2 text-sm text-[var(--color-fg)]">
          {run.inputPreview ?? (
            <span className="italic text-[var(--color-fg-subtle)]">no input</span>
          )}
        </p>
        {run.outputPreview && (
          <p className="line-clamp-2 text-xs text-[var(--color-fg-muted)]">{run.outputPreview}</p>
        )}
        {run.error && <p className="text-xs text-[var(--color-danger)]">{run.error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--color-fg-subtle)]">
          <span>
            {run.intent} · {run.providerUsed ?? '—'} {run.modelUsed ?? ''}
          </span>
          <span>
            {run.inputTokens ?? 0}↑ {run.outputTokens ?? 0}↓
            {run.costUsd != null && ` · $${run.costUsd.toFixed(4)}`}
            {dur != null && ` · ${dur}s`}
          </span>
        </div>
      </Card>
    </li>
  );
}

function TableView({ runs }: { runs: AgentRunRow[] }) {
  return (
    <Card className="overflow-hidden !p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-left text-xs uppercase tracking-wide text-[var(--color-fg-subtle)]">
          <tr>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Intent</th>
            <th className="px-3 py-2">Model</th>
            <th className="px-3 py-2 text-right">Tokens</th>
            <th className="px-3 py-2 text-right">Cost</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-[var(--color-fg-subtle)]">
                No runs.
              </td>
            </tr>
          )}
          {runs.map((r) => {
            const s = STATUS_STYLE[r.status];
            return (
              <tr key={r.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-3 py-2 font-mono text-xs">{r.kind}</td>
                <td className="px-3 py-2 text-xs">{r.intent}</td>
                <td className="px-3 py-2 text-xs">
                  {r.providerUsed ?? '—'}/{r.modelUsed ?? '—'}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {(r.inputTokens ?? 0) + (r.outputTokens ?? 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : '—'}
                </td>
                <td className={cn('px-3 py-2 text-xs', s.color)}>{r.status}</td>
                <td className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">
                  {new Date(r.startedAt).toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function KanbanView({ runs }: { runs: AgentRunRow[] }) {
  const cols: AgentRunRow['status'][] = ['pending', 'running', 'success', 'failed'];
  const grouped = Object.fromEntries(cols.map((c) => [c, [] as AgentRunRow[]])) as Record<
    AgentRunRow['status'],
    AgentRunRow[]
  >;
  for (const r of runs) {
    if (grouped[r.status]) grouped[r.status]!.push(r);
  }
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {cols.map((c) => {
        const s = STATUS_STYLE[c];
        return (
          <Card key={c} className="!p-3">
            <div className={cn('mb-3 flex items-center gap-2 text-xs uppercase', s.color)}>
              <s.Icon className="h-3.5 w-3.5" /> {c} ({grouped[c]!.length})
            </div>
            <ul className="space-y-2">
              {grouped[c]!.slice(0, 12).map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2 text-xs"
                >
                  <div className="font-mono">{r.kind}</div>
                  <div className="mt-1 line-clamp-2 text-[var(--color-fg-muted)]">
                    {r.inputPreview ?? '—'}
                  </div>
                </li>
              ))}
              {grouped[c]!.length === 0 && (
                <li className="text-xs text-[var(--color-fg-subtle)]">—</li>
              )}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}

function TimelineView({ runs, toolCalls }: { runs: AgentRunRow[]; toolCalls: ToolCallRow[] }) {
  type Event =
    | { type: 'run'; at: string; run: AgentRunRow }
    | { type: 'tool'; at: string; tool: ToolCallRow };
  const items: Event[] = [
    ...runs.map((r) => ({ type: 'run' as const, at: r.startedAt, run: r })),
    ...toolCalls.map((tc) => ({ type: 'tool' as const, at: tc.requestedAt, tool: tc })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <Card className="!p-0">
      <ol className="relative space-y-0">
        {items.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-[var(--color-fg-subtle)]">
            No activity in the last 7 days.
          </li>
        )}
        {items.slice(0, 80).map((e, i) => (
          <motion.li
            key={`${e.type}-${e.type === 'run' ? e.run.id : e.tool.id}`}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.4) }}
            className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-2.5 last:border-0"
          >
            <span className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--color-brand)]" />
            <div className="min-w-0 flex-1">
              {e.type === 'run' ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{e.run.kind}</span>
                    <span className={cn('text-[10px]', STATUS_STYLE[e.run.status].color)}>
                      {e.run.status}
                    </span>
                  </div>
                  <p className="line-clamp-1 text-xs text-[var(--color-fg-muted)]">
                    {e.run.inputPreview ?? e.run.outputPreview ?? '—'}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">tool · {e.tool.tool}</span>
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">
                      {e.tool.status} {e.tool.aclMode ? `· ${e.tool.aclMode}` : ''}
                    </span>
                  </div>
                  {e.tool.conversationId && (
                    <Link
                      href={`/chat?id=${e.tool.conversationId}`}
                      className="text-[11px] text-[var(--color-brand)] hover:underline"
                    >
                      Open thread
                    </Link>
                  )}
                </>
              )}
              <span className="text-[10px] text-[var(--color-fg-subtle)]">
                {new Date(e.at).toLocaleString()}
              </span>
            </div>
          </motion.li>
        ))}
      </ol>
    </Card>
  );
}
