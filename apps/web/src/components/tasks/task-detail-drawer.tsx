'use client';
/**
 * Slide-over task editor. Edits title, body, status, kind, project, due date,
 * leverage, blocked reason via updateTaskAction. Stays in the Tasks page
 * context (no navigation).
 */
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input } from '@metu/ui';
import { X, Trash2, Loader2 } from 'lucide-react';
import { updateTaskAction } from '@/app/actions/project';
import type { TaskItem, ProjectOption } from './tasks-client';

const STATUSES = ['inbox', 'next', 'doing', 'blocked', 'done', 'dropped'] as const;
const KINDS = ['deep', 'shallow', 'creative', 'maintenance'] as const;

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  // datetime-local wants YYYY-MM-DDTHH:mm in local time
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function TaskDetailDrawer({
  task,
  projects,
  onClose,
  onSaved,
  onDelete,
}: {
  task: TaskItem;
  projects: ProjectOption[];
  onClose: () => void;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const [status, setStatus] = useState(task.status);
  const [kind, setKind] = useState(task.kind);
  const [projectId, setProjectId] = useState(task.projectId ?? '');
  const [dueAt, setDueAt] = useState(toDateInput(task.dueAt));
  const [leverage, setLeverage] = useState(
    task.leverageScore != null ? String(task.leverageScore) : '',
  );
  const [blockedReason, setBlockedReason] = useState(task.blockedReason ?? '');

  function save() {
    start(async () => {
      const res = await updateTaskAction({
        id: task.id,
        title: title.trim() || task.title,
        body: body.trim() ? body : null,
        status: status as never,
        kind: kind as never,
        projectId: projectId || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        leverageScore: leverage ? Number(leverage) : null,
        blockedReason: blockedReason.trim() ? blockedReason : null,
      });
      if (res.ok) {
        toast.success('Task saved');
        onSaved();
        onClose();
      } else toast.error(res.error ?? 'Failed');
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Edit task</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-4 w-4 text-[var(--color-fg-subtle)]" />
          </button>
        </div>

        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Notes">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            placeholder="Details, context, links…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select value={status} onChange={setStatus} options={STATUSES} />
          </Field>
          <Field label="Kind">
            <Select value={kind} onChange={setKind} options={KINDS} />
          </Field>
        </div>

        <Field label="Project">
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Due">
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </Field>
          <Field label="Leverage (0–100)">
            <Input
              type="number"
              min={0}
              max={100}
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
            />
          </Field>
        </div>

        {status === 'blocked' && (
          <Field label="Blocked reason">
            <Input
              value={blockedReason}
              onChange={(e) => setBlockedReason(e.target.value)}
              placeholder="What's blocking it?"
            />
          </Field>
        )}

        <div className="mt-auto flex items-center gap-2 pt-4">
          <Button onClick={save} disabled={pending} className="flex-1">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          <Button variant="ghost" onClick={onDelete} disabled={pending} aria-label="Delete">
            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[var(--color-fg-subtle)]">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
