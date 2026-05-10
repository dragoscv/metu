'use client';
import { Button, Input, Select } from '@metu/ui';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteTaskAction, updateTaskAction } from '@/app/actions/project';

const STATUS = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'next', label: 'Next' },
  { value: 'doing', label: 'Doing' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'dropped', label: 'Dropped' },
] as const;

const KIND = [
  { value: 'deep', label: 'Deep' },
  { value: 'shallow', label: 'Shallow' },
  { value: 'creative', label: 'Creative' },
  { value: 'maintenance', label: 'Maintenance' },
] as const;

export interface TaskEditData {
  id: string;
  projectId: string | null;
  goalId: string | null;
  title: string;
  body: string | null;
  status: string;
  kind: string;
  leverageScore: number | null;
  blockedReason: string | null;
  dueAt: string | null;
}

function dateInputValue(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function TaskEditForm({
  task,
  projects,
  goals,
  backHref,
}: {
  task: TaskEditData;
  projects: { id: string; name: string }[];
  goals: { id: string; title: string }[];
  backHref: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [status, setStatus] = useState(task.status);
  const [kind, setKind] = useState(task.kind);
  const [leverage, setLeverage] = useState(
    typeof task.leverageScore === 'number' ? String(task.leverageScore) : '',
  );
  const [blockedReason, setBlockedReason] = useState(task.blockedReason ?? '');
  const [dueAt, setDueAt] = useState(dateInputValue(task.dueAt));
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const [goalId, setGoalId] = useState(task.goalId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingDelete, startDelete] = useTransition();

  const dirty =
    title !== task.title ||
    body !== (task.body ?? '') ||
    status !== task.status ||
    kind !== task.kind ||
    leverage !== (typeof task.leverageScore === 'number' ? String(task.leverageScore) : '') ||
    blockedReason !== (task.blockedReason ?? '') ||
    dueAt !== dateInputValue(task.dueAt) ||
    projectId !== (task.projectId ?? '') ||
    goalId !== (task.goalId ?? '');

  const save = () => {
    setError(null);
    startSave(async () => {
      const lev = leverage.trim() === '' ? null : Number(leverage);
      const res = await updateTaskAction({
        id: task.id,
        title: title.trim(),
        body: body.trim() || null,
        status: status as 'inbox' | 'next' | 'doing' | 'blocked' | 'done' | 'dropped',
        kind: kind as 'deep' | 'shallow' | 'creative' | 'maintenance',
        leverageScore: typeof lev === 'number' && Number.isFinite(lev) ? lev : null,
        blockedReason: blockedReason.trim() || null,
        dueAt: dueAt || null,
        projectId: projectId || null,
        goalId: goalId || null,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm('Delete this task?')) return;
    startDelete(async () => {
      const res = await deleteTaskAction(task.id);
      if (!res.ok) setError(res.error);
      else router.push(backHref);
    });
  };

  return (
    <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Notes</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          placeholder="Why? Sub-steps? Links?"
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Kind</label>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Leverage</label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="10"
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            placeholder="0–10"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Due</label>
          <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </div>
      </div>

      {status === 'blocked' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Blocked reason</label>
          <Input
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
            placeholder="What's blocking?"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Project</label>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">— No project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Pin to goal</label>
        <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">— No goal —</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </Select>
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Pinning a task to a goal makes it appear as a milestone on the goal board.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
        <Button variant="danger" size="sm" onClick={onDelete} disabled={pendingDelete}>
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Button onClick={save} disabled={!dirty || pendingSave || !title.trim()} size="sm">
          {pendingSave ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
