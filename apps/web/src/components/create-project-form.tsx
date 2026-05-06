'use client';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button, Input } from '@metu/ui';
import { createProjectAction } from '@/app/actions/project';

export function CreateProjectForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="subtle" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New project
      </Button>
    );
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="One-line summary (optional)"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={pending || !name.trim()}
          onClick={() =>
            start(async () => {
              const slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/(^-|-$)/g, '')
                .slice(0, 60);
              const res = await createProjectAction({
                name: name.trim(),
                slug,
                summary: summary.trim() || undefined,
                metadata: {},
              });
              if (res.ok) {
                toast.success('Project created.');
                setOpen(false);
                setName('');
                setSummary('');
              } else toast.error(res.error ?? 'Failed');
            })
          }
        >
          Create
        </Button>
      </div>
    </div>
  );
}
