'use client';
/**
 * Client island for the goals board kanban. Handles HTML5 drag-to-change-status
 * with optimistic UI + server action + router.refresh on success.
 *
 * Stays focused: snapshot, targets, and check-ins on the parent page remain
 * fully server-rendered.
 */
import { useState, useTransition, type DragEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MomentumBar, StatusDot } from '@metu/ui';
import { updateGoalAction } from '@/app/actions/goals';

export type SubGoalStatus = 'active' | 'paused' | 'achieved' | 'dropped';

export interface BoardSubGoal {
  id: string;
  title: string;
  progress: number;
  status: SubGoalStatus;
  drift: string;
  weight: number;
  dueAt: string | null;
}

const COLUMNS: SubGoalStatus[] = ['active', 'paused', 'achieved', 'dropped'];
const COLUMN_LABEL: Record<SubGoalStatus, string> = {
  active: 'In flight',
  paused: 'Paused',
  achieved: 'Done',
  dropped: 'Dropped',
};

interface Props {
  subs: BoardSubGoal[];
}

export function BoardColumnsClient({ subs: initial }: Props) {
  const router = useRouter();
  const [subs, setSubs] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<SubGoalStatus | null>(null);
  const [, startTransition] = useTransition();

  const grouped: Record<SubGoalStatus, BoardSubGoal[]> = {
    active: [],
    paused: [],
    achieved: [],
    dropped: [],
  };
  for (const s of subs) grouped[s.status].push(s);

  function onDragStart(e: DragEvent<HTMLDivElement>, id: string) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragId(id);
  }
  function onDragEnd() {
    setDragId(null);
    setHoverCol(null);
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, col: SubGoalStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (hoverCol !== col) setHoverCol(col);
  }
  function onDragLeave(col: SubGoalStatus) {
    if (hoverCol === col) setHoverCol(null);
  }
  function onDrop(e: DragEvent<HTMLDivElement>, col: SubGoalStatus) {
    e.preventDefault();
    setHoverCol(null);
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    if (!id) return;
    const current = subs.find((s) => s.id === id);
    if (!current || current.status === col) return;

    const previous = subs;
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, status: col } : s)));

    startTransition(async () => {
      const res = await updateGoalAction({ id, status: col });
      if (!res.ok) {
        setSubs(previous);
        toast.error(`Could not move milestone: ${res.error}`);
        return;
      }
      toast.success(`Moved to ${COLUMN_LABEL[col]}`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => (
        <div
          key={col}
          onDragOver={(e) => onDragOver(e, col)}
          onDragLeave={() => onDragLeave(col)}
          onDrop={(e) => onDrop(e, col)}
          className={`flex flex-col gap-2 rounded-xl border p-3 transition ${
            hoverCol === col
              ? 'border-[var(--color-brand)] bg-[var(--color-bg-elevated)]'
              : 'bg-[var(--color-bg-elevated)]/40 border-[var(--color-border)]'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
            <span>{COLUMN_LABEL[col]}</span>
            <span className="font-mono tabular-nums text-[var(--color-fg-subtle)]">
              {grouped[col].length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {grouped[col].length === 0 ? (
              <p className="text-xs italic text-[var(--color-fg-subtle)]">
                {hoverCol === col ? 'Drop to move here' : 'Nothing here'}
              </p>
            ) : (
              grouped[col].map((s) => (
                <SubGoalCard
                  key={s.id}
                  sub={s}
                  dragging={dragId === s.id}
                  onDragStart={(e) => onDragStart(e, s.id)}
                  onDragEnd={onDragEnd}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface SubGoalCardProps {
  sub: BoardSubGoal;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function SubGoalCard({ sub, dragging, onDragStart, onDragEnd }: SubGoalCardProps) {
  const driftTone =
    sub.drift === 'on_track' ? 'success' : sub.drift === 'slipping' ? 'warning' : 'danger';
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group rounded-lg border bg-[var(--color-bg-card)] transition ${
        dragging
          ? 'border-[var(--color-brand)] opacity-50'
          : 'border-[var(--color-border)] hover:border-[var(--color-brand)]'
      }`}
    >
      <Link href={`/goals/${sub.id}`} className="block p-2.5">
        <div className="flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-sm font-medium leading-tight">{sub.title}</span>
          <StatusDot state={driftTone} size="sm" />
        </div>
        <MomentumBar value={sub.progress} className="mt-2" />
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
          <span className="font-mono tabular-nums">{Math.round(sub.progress * 100)}%</span>
          <span>
            w{sub.weight}
            {sub.dueAt && ` · ${new Date(sub.dueAt).toLocaleDateString()}`}
          </span>
        </div>
      </Link>
    </div>
  );
}
