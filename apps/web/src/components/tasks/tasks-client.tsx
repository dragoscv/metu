'use client';
/**
 * Dedicated Tasks workspace. Server passes the full task list (with project
 * names) + project options; this client handles filtering (nuqs, URL-synced),
 * smart sections, inline status changes, quick-add, and a detail drawer.
 *
 * Reuses the existing task Server Actions:
 *   createTaskAction / updateTaskAction / markTaskDoneAction /
 *   markTaskUndoneAction / deleteTaskAction
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseAsString, useQueryStates } from 'nuqs';
import Link from 'next/link';
import { toast } from 'sonner';
import { Badge, Button, Input } from '@metu/ui';
import {
  CheckCircle2,
  Circle,
  Loader2,
  Plus,
  Trash2,
  ExternalLink,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import {
  createTaskAction,
  updateTaskAction,
  markTaskDoneAction,
  deleteTaskAction,
} from '@/app/actions/project';
import { TaskDetailDrawer } from './task-detail-drawer';

export interface TaskItem {
  id: string;
  title: string;
  body: string | null;
  status: string;
  kind: string;
  leverageScore: number | null;
  blockedReason: string | null;
  dueAt: string | null;
  projectId: string | null;
  projectName: string | null;
  goalId: string | null;
  aiSuggested: number | null;
  sourceApp: string | null;
  sourceUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const STATUSES = ['inbox', 'next', 'doing', 'blocked', 'done', 'dropped'] as const;
const KINDS = ['deep', 'shallow', 'creative', 'maintenance'] as const;

// Smart sections (open work first). 'done'/'dropped' only show when filtered.
const SECTIONS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'doing', label: 'Doing now', statuses: ['doing'] },
  { key: 'next', label: 'Next', statuses: ['next'] },
  { key: 'inbox', label: 'Inbox', statuses: ['inbox'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { key: 'done', label: 'Done', statuses: ['done', 'dropped'] },
];

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'doing':
      return 'info';
    case 'next':
      return 'success';
    case 'blocked':
      return 'danger';
    case 'done':
      return 'success';
    case 'dropped':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const overdue = d.getTime() < now.getTime();
  const sameDay = d.toDateString() === now.toDateString();
  const text = sameDay
    ? `today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { text, overdue };
}

export function TasksClient({
  tasks,
  projects,
}: {
  tasks: TaskItem[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState('');

  const [filters, setFilters] = useQueryStates({
    status: parseAsString.withDefault(''),
    kind: parseAsString.withDefault(''),
    project: parseAsString.withDefault(''),
    due: parseAsString.withDefault(''),
    q: parseAsString.withDefault(''),
  });

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (filters.status && t.status !== filters.status) return false;
      if (filters.kind && t.kind !== filters.kind) return false;
      if (filters.project && t.projectId !== filters.project) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (
          !t.title.toLowerCase().includes(q) &&
          !(t.body ?? '').toLowerCase().includes(q)
        )
          return false;
      }
      if (filters.due) {
        if (!t.dueAt && filters.due !== 'none') return false;
        const d = t.dueAt ? new Date(t.dueAt) : null;
        const now = new Date();
        if (filters.due === 'overdue' && !(d && d < now)) return false;
        if (filters.due === 'today' && !(d && d.toDateString() === now.toDateString()))
          return false;
        if (
          filters.due === 'week' &&
          !(d && d.getTime() < now.getTime() + 7 * 86400_000)
        )
          return false;
        if (filters.due === 'none' && t.dueAt) return false;
      }
      return true;
    });
  }, [tasks, filters]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const sec of SECTIONS) map.set(sec.key, []);
    for (const t of filtered) {
      const sec = SECTIONS.find((s) => s.statuses.includes(t.status));
      if (sec) map.get(sec.key)!.push(t);
    }
    return map;
  }, [filtered]);

  const refresh = () => router.refresh();

  function changeStatus(id: string, status: string) {
    start(async () => {
      const res = await updateTaskAction({ id, status: status as never });
      if (res.ok) {
        toast.success(`Moved to ${status}`);
        refresh();
      } else toast.error(res.error ?? 'Failed');
    });
  }

  function complete(id: string, currentlyDone: boolean) {
    start(async () => {
      const res = currentlyDone
        ? await updateTaskAction({ id, status: 'next' as never })
        : await markTaskDoneAction(id);
      if (res.ok) refresh();
      else toast.error(res.error ?? 'Failed');
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteTaskAction(id);
      if (res.ok) {
        toast.success('Task deleted');
        setOpenId(null);
        refresh();
      } else toast.error(res.error ?? 'Failed');
    });
  }

  function submitQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickAdd.trim() || pending) return;
    const title = quickAdd;
    start(async () => {
      const res = await createTaskAction({
        title,
        status: 'inbox',
        kind: 'shallow',
        projectId: filters.project || undefined,
      });
      if (res.ok) {
        setQuickAdd('');
        refresh();
      } else toast.error(res.error ?? 'Failed');
    });
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const openTask = openId ? tasks.find((t) => t.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Quick add */}
      <form onSubmit={submitQuickAdd} className="flex items-center gap-2">
        <Input
          value={quickAdd}
          onChange={(e) => setQuickAdd(e.target.value)}
          placeholder="Quick add to inbox… (Enter to save)"
          className="h-9 flex-1"
          disabled={pending}
        />
        <Button type="submit" variant="subtle" size="sm" disabled={!quickAdd.trim() || pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </form>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={filters.status}
          onChange={(v) => setFilters({ status: v })}
          placeholder="All statuses"
          options={STATUSES.map((s) => ({ value: s, label: s }))}
        />
        <FilterSelect
          value={filters.kind}
          onChange={(v) => setFilters({ kind: v })}
          placeholder="All kinds"
          options={KINDS.map((k) => ({ value: k, label: k }))}
        />
        <FilterSelect
          value={filters.project}
          onChange={(v) => setFilters({ project: v })}
          placeholder="All projects"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
        />
        <FilterSelect
          value={filters.due}
          onChange={(v) => setFilters({ due: v })}
          placeholder="Any due"
          options={[
            { value: 'overdue', label: 'Overdue' },
            { value: 'today', label: 'Due today' },
            { value: 'week', label: 'Due this week' },
            { value: 'none', label: 'No due date' },
          ]}
        />
        <Input
          value={filters.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          placeholder="Search…"
          className="h-8 w-40"
        />
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters({ status: '', kind: '', project: '', due: '', q: '' })
            }
          >
            Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-[var(--color-fg-subtle)]">
          {filtered.length} task{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Sections */}
      {SECTIONS.map((sec) => {
        const items = grouped.get(sec.key) ?? [];
        // Hide Done section unless it has items and (no status filter or status is done/dropped)
        if (items.length === 0) return null;
        return (
          <section key={sec.key} className="space-y-1.5">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-fg-subtle)]">
              {sec.label}
              <span className="text-[var(--color-fg-subtle)]/60">{items.length}</span>
            </h2>
            <ul className="flex flex-col gap-1.5">
              {items.map((t) => (
                <TaskLine
                  key={t.id}
                  task={t}
                  pending={pending}
                  onComplete={complete}
                  onChangeStatus={changeStatus}
                  onOpen={() => setOpenId(t.id)}
                  onDelete={remove}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-fg-subtle)]">
          No tasks match your filters.
        </div>
      )}

      {openTask && (
        <TaskDetailDrawer
          task={openTask}
          projects={projects}
          onClose={() => setOpenId(null)}
          onSaved={refresh}
          onDelete={() => remove(openTask.id)}
        />
      )}
    </div>
  );
}

function TaskLine({
  task: t,
  pending,
  onComplete,
  onChangeStatus,
  onOpen,
  onDelete,
}: {
  task: TaskItem;
  pending: boolean;
  onComplete: (id: string, done: boolean) => void;
  onChangeStatus: (id: string, status: string) => void;
  onOpen: () => void;
  onDelete: (id: string) => void;
}) {
  const done = t.status === 'done';
  const due = dueLabel(t.dueAt);
  return (
    <li className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2">
      <button
        onClick={() => onComplete(t.id, done)}
        disabled={pending}
        className="shrink-0 text-[var(--color-fg-subtle)] hover:text-[var(--color-success)]"
        aria-label={done ? 'Reopen task' : 'Complete task'}
      >
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />
        ) : (
          <Circle className="h-4 w-4" />
        )}
      </button>

      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={`block truncate text-sm ${done ? 'text-[var(--color-fg-subtle)] line-through' : ''}`}
        >
          {t.aiSuggested && (
            <Sparkles className="mr-1 inline h-3 w-3 text-[var(--color-brand)]" />
          )}
          {t.title}
        </span>
        {(t.projectName || t.blockedReason) && (
          <span className="block truncate text-xs text-[var(--color-fg-subtle)]">
            {t.projectName}
            {t.blockedReason ? ` · ${t.blockedReason}` : ''}
          </span>
        )}
      </button>

      {due && (
        <span
          className={`shrink-0 text-xs ${due.overdue ? 'text-[var(--color-danger)]' : 'text-[var(--color-fg-subtle)]'}`}
        >
          {due.text}
        </span>
      )}

      {t.sourceUrl && (
        <Link
          href={t.sourceUrl}
          target="_blank"
          className="shrink-0 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}

      {/* Inline status dropdown */}
      <StatusMenu value={t.status} onChange={(s) => onChangeStatus(t.id, s)} />

      <button
        onClick={() => onDelete(t.id)}
        disabled={pending}
        className="shrink-0 text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:text-[var(--color-danger)] group-hover:opacity-100"
        aria-label="Delete task"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

function StatusMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="inline-flex items-center gap-1"
      >
        <Badge size="xs" variant={statusTone(value)}>
          {value}
          <ChevronDown className="ml-0.5 h-3 w-3" />
        </Badge>
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-32 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-lg">
          {STATUSES.map((s) => (
            <button
              key={s}
              onMouseDown={() => {
                onChange(s);
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-bg-hover)] ${s === value ? 'font-semibold' : ''}`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-fg)]"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
