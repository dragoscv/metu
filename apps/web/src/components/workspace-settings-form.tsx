'use client';

import { useState, useTransition } from 'react';
import { Card, Button } from '@metu/ui';
import { toast } from 'sonner';
import { updateWorkspaceAction } from '@/app/actions/workspace';

export function WorkspaceSettingsForm({
  initialName,
  initialSlug,
}: {
  initialName: string;
  initialSlug: string;
}) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [pending, start] = useTransition();
  const dirty = name !== initialName || slug !== initialSlug;

  return (
    <Card className="space-y-4">
      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Slug
        </span>
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          maxLength={32}
          pattern="[a-z0-9-]+"
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 font-mono text-sm"
        />
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          Used in URLs and CLI. Lowercase, numbers, hyphens.
        </span>
      </label>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-3">
        <Button
          variant="ghost"
          disabled={!dirty || pending}
          onClick={() => {
            setName(initialName);
            setSlug(initialSlug);
          }}
        >
          Reset
        </Button>
        <Button
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await updateWorkspaceAction({ name: name.trim(), slug: slug.trim() });
              if (r.ok) toast.success('Workspace updated.');
              else toast.error(r.error === 'slug_taken' ? 'That slug is already taken.' : r.error);
            })
          }
        >
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Card>
  );
}
