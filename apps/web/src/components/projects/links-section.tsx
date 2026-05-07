'use client';
import { Badge, Button, Input } from '@metu/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ExternalLink,
  FileText,
  Github,
  Globe,
  Hash,
  Layers,
  Link2,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ComponentType } from 'react';
import { addProjectLinkAction, removeProjectLinkAction } from '@/app/actions/project-links';
import { RepoPicker } from './repo-picker';
import { Favicon } from '@/components/favicon';

export interface LinkRow {
  id: string;
  provider: string;
  kind: string;
  title: string;
  url: string;
  metadata: Record<string, unknown>;
  addedAt: string;
}

const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  github: Github,
  gitlab: Github,
  notion: FileText,
  linear: Layers,
  slack: Hash,
  gdrive: FileText,
  figma: Layers,
  generic: Globe,
};

const PROVIDER_LABEL: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  notion: 'Notion',
  linear: 'Linear',
  slack: 'Slack',
  gdrive: 'Drive',
  figma: 'Figma',
  generic: 'Link',
};

export function LinksSection({ projectId, links }: { projectId: string; links: LinkRow[] }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const existingUrls = links.map((l) => l.url);

  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Links & repositories</h2>
          <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
            Attach the repos, docs, dashboards, and channels that belong to this project. GitHub
            events from linked repos will route here automatically.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding((a) => !a)}>
            <Link2 className="h-3.5 w-3.5" />
            Add link
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <Github className="h-3.5 w-3.5" />
            Add GitHub repo
          </Button>
        </div>
      </header>

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <AddUrlForm
              projectId={projectId}
              onDone={() => setAdding(false)}
              onCancel={() => setAdding(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {links.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
          No links yet. Attach a GitHub repo, docs URL, design file, or anything else.
        </p>
      ) : (
        <ul className="space-y-1">
          {links.map((l) => (
            <LinkItem key={l.id} link={l} />
          ))}
        </ul>
      )}

      <RepoPicker
        projectId={projectId}
        existingUrls={existingUrls}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
      />
    </section>
  );
}

function LinkItem({ link }: { link: LinkRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const Icon = PROVIDER_ICONS[link.provider] ?? Globe;
  const onRemove = () => {
    if (!confirm(`Remove "${link.title}" from this project?`)) return;
    start(async () => {
      const res = await removeProjectLinkAction(link.id);
      if (res.ok) router.refresh();
    });
  };
  const meta = link.metadata as Record<string, unknown>;
  const language = typeof meta.language === 'string' ? meta.language : null;
  const isPrivate = meta.private === true;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2"
    >
      {link.provider === 'generic' ? (
        <Favicon url={link.url} />
      ) : (
        <Icon className="h-4 w-4 shrink-0 text-[var(--color-fg-muted)]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{link.title}</span>
          <Badge size="xs" variant="neutral">
            {PROVIDER_LABEL[link.provider] ?? link.provider}
          </Badge>
          {link.kind !== 'url' && (
            <Badge size="xs" variant="outline">
              {link.kind}
            </Badge>
          )}
          {isPrivate && (
            <Badge size="xs" variant="warning">
              private
            </Badge>
          )}
          {language && (
            <Badge size="xs" variant="neutral">
              {language}
            </Badge>
          )}
        </div>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
        >
          {link.url}
        </a>
      </div>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
        aria-label="Open"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      <button
        type="button"
        onClick={onRemove}
        disabled={pending}
        aria-label="Remove link"
        className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-danger)] disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </motion.li>
  );
}

function AddUrlForm({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState('generic');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const guessProvider = (u: string) => {
    try {
      const host = new URL(u).hostname;
      if (host.includes('github.com')) return 'github';
      if (host.includes('gitlab.com')) return 'gitlab';
      if (host.includes('notion.so') || host.includes('notion.site')) return 'notion';
      if (host.includes('linear.app')) return 'linear';
      if (host.includes('slack.com')) return 'slack';
      if (host.includes('docs.google.com') || host.includes('drive.google.com')) return 'gdrive';
      if (host.includes('figma.com')) return 'figma';
      return 'generic';
    } catch {
      return 'generic';
    }
  };

  const onUrl = (v: string) => {
    setUrl(v);
    setProvider(guessProvider(v));
    if (!title) {
      try {
        const u = new URL(v);
        setTitle(u.hostname.replace(/^www\./, '') + u.pathname);
      } catch {
        // ignore
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!url || !title.trim()) return;
    start(async () => {
      const res = await addProjectLinkAction({
        projectId,
        provider: provider as
          | 'github'
          | 'gitlab'
          | 'notion'
          | 'linear'
          | 'slack'
          | 'gdrive'
          | 'figma'
          | 'generic',
        kind: 'url',
        url,
        title: title.trim(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setUrl('');
      setTitle('');
      router.refresh();
      onDone();
    });
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3"
    >
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <Input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://…"
          type="url"
          required
          autoFocus
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          required
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          Detected:{' '}
          <Badge size="xs" variant="neutral">
            {PROVIDER_LABEL[provider] ?? provider}
          </Badge>
        </span>
        <div className="flex gap-1.5">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending || !url || !title.trim()}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </form>
  );
}
