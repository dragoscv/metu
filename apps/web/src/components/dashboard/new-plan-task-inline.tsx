'use client';

import { Button } from '@metu/ui';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createTaskAction } from '@/app/actions/project';

/**
 * Inline "new task" affordance for the dashboard Plan tab. Mirrors the
 * goal-board pattern (apps/web/src/components/goals/new-goal-task-inline.tsx)
 * but creates an unpinned task — user can wire it to a goal/project later.
 */
export function NewPlanTaskInline() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New task
      </Button>
    );
  }

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    start(async () => {
      const res = await createTaskAction({ title: t, status: 'inbox', kind: 'shallow' });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Task added to inbox');
      setTitle('');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        placeholder="Task title…"
        maxLength={280}
        disabled={pending}
        className="h-8 w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      <Button size="sm" onClick={submit} disabled={pending || !title.trim()}>
        {pending ? 'Adding…' : 'Add'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setTitle('');
          setOpen(false);
        }}
        disabled={pending}
      >
        Cancel
      </Button>
    </div>
  );
}
