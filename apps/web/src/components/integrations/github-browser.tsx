'use client';
import { Badge, Button, EmptyState, Input, Select, Skeleton } from '@metu/ui';
import { motion } from 'framer-motion';
import { ExternalLink, Github, Link2, Loader2, Search, Star } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  assignGithubRepoAction,
  listGithubReposAction,
  type GithubAccount,
  type GithubRepo,
} from '@/app/actions/github';

interface ProjectOption {
  id: string;
  name: string;
  slug: string;
}

export function GithubBrowser({
  accounts,
  projects,
}: {
  accounts: GithubAccount[];
  projects: ProjectOption[];
}) {
  const [accountId, setAccountId] = useState<string | null>(accounts[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(
      async () => {
        const res = await listGithubReposAction({
          integrationId: accountId,
          search: search.trim() || undefined,
          perPage: 50,
        });
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setError(res.error);
          setRepos([]);
          return;
        }
        setRepos(res.repos);
      },
      search ? 300 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [accountId, search]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={<Github className="h-5 w-5" />}
        title="No GitHub account connected"
        description="Connect a GitHub account on the Integrations page first."
        action={
          <Link
            href="/integrations"
            className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
          >
            <Link2 className="h-3.5 w-3.5" />
            Open Integrations
          </Link>
        }
      />
    );
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<Github className="h-5 w-5" />}
        title="No projects to assign to"
        description="Create a project first, then link repos to it."
        action={
          <Link
            href="/projects/new"
            className="inline-flex h-8 items-center gap-2 rounded-md bg-[var(--color-brand)] px-3 text-sm font-medium text-[var(--color-brand-fg)] hover:opacity-90"
          >
            New project
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2">
        <div className="flex flex-wrap gap-1">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccountId(a.id)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                accountId === a.id
                  ? 'bg-[var(--color-brand)] text-[var(--color-brand-fg)]'
                  : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
              }`}
            >
              @{a.login}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search repositories…"
            className="h-8 w-64 pl-7 text-xs"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {loading && (
        <ul className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i}>
              <Skeleton className="h-14 w-full rounded-md" />
            </li>
          ))}
        </ul>
      )}

      {!loading && repos && repos.length === 0 && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
          No repositories match.
        </p>
      )}

      {!loading && repos && repos.length > 0 && (
        <ul className="space-y-1">
          {repos.map((repo, i) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              integrationId={accountId!}
              projects={projects}
              index={i}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RepoRow({
  repo,
  integrationId,
  projects,
  index,
}: {
  repo: GithubRepo;
  integrationId: string;
  projects: ProjectOption[];
  index: number;
}) {
  const [projectId, setProjectId] = useState<string>(projects[0]?.id ?? '');
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<'idle' | 'linked' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onAssign = () => {
    if (!projectId) return;
    setError(null);
    start(async () => {
      const res = await assignGithubRepoAction({ projectId, integrationId, repo });
      if (!res.ok) {
        setError(res.error);
        setStatus('error');
        return;
      }
      setStatus('linked');
    });
  };

  const linkedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projectId, projects],
  );

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(index * 0.01, 0.15) }}
      className="flex flex-wrap items-start gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/integrations/github/${repo.owner}/${repo.name}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {repo.fullName}
          </Link>
          {repo.private && (
            <Badge size="xs" variant="warning">
              private
            </Badge>
          )}
          {repo.fork && (
            <Badge size="xs" variant="neutral">
              fork
            </Badge>
          )}
          {repo.archived && (
            <Badge size="xs" variant="neutral">
              archived
            </Badge>
          )}
          {repo.language && (
            <Badge size="xs" variant="neutral">
              {repo.language}
            </Badge>
          )}
          {repo.stars > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--color-fg-subtle)]">
              <Star className="h-3 w-3" />
              {repo.stars}
            </span>
          )}
        </div>
        {repo.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-fg-muted)]">
            {repo.description}
          </p>
        )}
        {error && <p className="mt-1 text-xs text-[var(--color-danger)]">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {status === 'linked' ? (
          <Link
            href={`/projects/${linkedProject?.id ?? ''}`}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-[var(--color-success-bg)] px-2 text-[11px] text-[var(--color-success)] hover:opacity-90"
          >
            <Link2 className="h-3 w-3" />
            Linked → {linkedProject?.name}
          </Link>
        ) : (
          <>
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-7 w-44 text-xs"
              aria-label="Project to link to"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="outline" onClick={onAssign} disabled={pending || !projectId}>
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Link
            </Button>
          </>
        )}
      </div>
    </motion.li>
  );
}
