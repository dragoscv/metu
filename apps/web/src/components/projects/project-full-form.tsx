'use client';
import { Badge, Button, Input, Select } from '@metu/ui';
import { Archive, Loader2, RefreshCcw, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  archiveProjectAction,
  deleteProjectAction,
  restoreProjectAction,
  updateProjectAction,
} from '@/app/actions/project';
import { LinksSection, type LinkRow } from './links-section';
import { ColorPicker, StackTagsInput } from './stack-tags-input';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
  { value: 'killed', label: 'Killed' },
];

export interface ProjectFullFormData {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  stateSummary: string | null;
  status: 'active' | 'paused' | 'archived' | 'killed';
  color: string | null;
  stack: string[];
  createdAt: string | null;
}

export function ProjectFullForm({
  project,
  links,
}: {
  project: ProjectFullFormData;
  links: LinkRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <IdentitySection project={project} onError={setError} onSaved={() => router.refresh()} />

      <StatusSection project={project} onError={setError} onSaved={() => router.refresh()} />

      <StackSection project={project} onError={setError} onSaved={() => router.refresh()} />

      <LinksSection projectId={project.id} links={links} />

      <DangerSection project={project} onError={setError} />
    </div>
  );
}

// ----------------- Identity -----------------

function IdentitySection({
  project,
  onError,
  onSaved,
}: {
  project: ProjectFullFormData;
  onError: (e: string | null) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [summary, setSummary] = useState(project.summary ?? '');
  const [color, setColor] = useState<string | null>(project.color);
  const [pending, start] = useTransition();
  const dirty =
    name !== project.name || summary !== (project.summary ?? '') || color !== project.color;

  const save = () => {
    onError(null);
    start(async () => {
      const res = await updateProjectAction({
        id: project.id,
        name: name.trim(),
        summary: summary.trim() || null,
        color,
      });
      if (!res.ok) onError(res.error);
      else onSaved();
    });
  };

  return (
    <Section
      title="Identity"
      subtitle="Name, summary, and color. Slug cannot be changed after creation."
    >
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Slug</label>
          <Input value={project.slug} disabled readOnly />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">Color</label>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          placeholder="One sentence about the project"
        />
      </div>
      <SectionFooter>
        <Button onClick={save} disabled={!dirty || pending || !name.trim()} size="sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save identity
        </Button>
      </SectionFooter>
    </Section>
  );
}

// ----------------- Status -----------------

function StatusSection({
  project,
  onError,
  onSaved,
}: {
  project: ProjectFullFormData;
  onError: (e: string | null) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(project.status);
  const [stateSummary, setStateSummary] = useState(project.stateSummary ?? '');
  const [pending, start] = useTransition();
  const dirty = status !== project.status || stateSummary !== (project.stateSummary ?? '');

  const save = () => {
    onError(null);
    start(async () => {
      const res = await updateProjectAction({
        id: project.id,
        status,
        stateSummary: stateSummary.trim() || null,
      });
      if (!res.ok) onError(res.error);
      else onSaved();
    });
  };

  return (
    <Section title="Status & pulse" subtitle="Where this project is right now.">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Status</label>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as ProjectFullFormData['status'])}
          className="max-w-xs"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">
          State summary (pulse)
        </label>
        <textarea
          value={stateSummary}
          onChange={(e) => setStateSummary(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          placeholder="3-sentence pulse — usually auto-generated from recent activity"
        />
      </div>
      <SectionFooter>
        <Button onClick={save} disabled={!dirty || pending} size="sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save status
        </Button>
      </SectionFooter>
    </Section>
  );
}

// ----------------- Stack -----------------

function StackSection({
  project,
  onError,
  onSaved,
}: {
  project: ProjectFullFormData;
  onError: (e: string | null) => void;
  onSaved: () => void;
}) {
  const [stack, setStack] = useState<string[]>(project.stack);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(stack) !== JSON.stringify(project.stack);

  const save = () => {
    onError(null);
    start(async () => {
      const res = await updateProjectAction({ id: project.id, stack });
      if (!res.ok) onError(res.error);
      else onSaved();
    });
  };

  return (
    <Section
      title="Stack"
      subtitle="Tags for the technologies, languages, or domains this project lives in. Used for filtering."
    >
      <StackTagsInput value={stack} onChange={setStack} />
      <SectionFooter>
        <Button onClick={save} disabled={!dirty || pending} size="sm">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save stack
        </Button>
      </SectionFooter>
    </Section>
  );
}

// ----------------- Danger -----------------

function DangerSection({
  project,
  onError,
}: {
  project: ProjectFullFormData;
  onError: (e: string | null) => void;
}) {
  const router = useRouter();
  const [pendingArchive, startArchive] = useTransition();
  const [pendingDelete, startDelete] = useTransition();
  const isArchived = project.status === 'archived';

  const onArchive = () => {
    onError(null);
    startArchive(async () => {
      const res = isArchived
        ? await restoreProjectAction(project.id)
        : await archiveProjectAction(project.id);
      if (!res.ok) onError(res.error);
      else router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
    onError(null);
    startDelete(async () => {
      const res = await deleteProjectAction(project.id);
      if (!res.ok) onError(res.error);
      else router.push('/projects');
    });
  };

  return (
    <section className="bg-[var(--color-danger-bg)]/30 space-y-3 rounded-xl border border-[var(--color-danger-border)] p-5">
      <header>
        <h2 className="text-sm font-semibold text-[var(--color-danger)]">Danger zone</h2>
        <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
          Archive hides the project from default views. Delete is soft — data is retained for 30
          days.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onArchive}
          disabled={pendingArchive || pendingDelete}
        >
          {pendingArchive ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isArchived ? (
            <RefreshCcw className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          {isArchived ? 'Restore' : 'Archive'}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={onDelete}
          disabled={pendingDelete || pendingArchive}
        >
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Badge size="xs" variant="neutral">
          status: {project.status}
        </Badge>
      </div>
    </section>
  );
}

// ----------------- Helpers -----------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function SectionFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end border-t border-[var(--color-border)] pt-3">{children}</div>
  );
}
