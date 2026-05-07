'use client';
import { Button, Input } from '@metu/ui';
import { Plus, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { createTaskAction } from '@/app/actions/project';

export function AddTaskInline({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || pending) return;
    const t = title;
    setError(null);
    start(async () => {
      const res = await createTaskAction({
        title: t,
        projectId,
        status: 'next',
        kind: 'shallow',
      });
      if (res.ok) {
        setTitle('');
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add task… (Enter to save)"
        className="h-9 flex-1"
        disabled={pending}
      />
      <Button type="submit" variant="subtle" size="sm" disabled={!title.trim() || pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </Button>
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
    </form>
  );
}
