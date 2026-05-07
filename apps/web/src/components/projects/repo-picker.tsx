'use client';
import { Badge, Button, Input, Skeleton } from '@metu/ui';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Github, Loader2, Search, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import {
  assignGithubRepoAction,
  listGithubAccountsAction,
  listGithubReposAction,
  type GithubAccount,
  type GithubRepo,
} from '@/app/actions/github';

interface Props {
  projectId: string;
  /** URLs already linked — used to gray out repos that are already attached. */
  existingUrls: string[];
  open: boolean;
  onClose: () => void;
}

export function RepoPicker({ projectId, existingUrls, open, onClose }: Props) {
  const [accounts, setAccounts] = useState<GithubAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load accounts when dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await listGithubAccountsAction();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAccounts(res.accounts);
      const first = res.accounts[0];
      if (first) setAccountId(first.id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load repos when account changes or search changes (debounced).
  useEffect(() => {
    if (!accountId || !open) return;
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
  }, [accountId, search, open]);

  // Reset on close.
  useEffect(() => {
    if (open) return;
    setRepos(null);
    setSearch('');
    setError(null);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal
          aria-label="Select GitHub repository"
        >
          <motion.div
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div className="flex items-center gap-2">
                <Github className="h-4 w-4" />
                <h2 className="text-sm font-semibold">Link a GitHub repository</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {accounts.length === 0 && !error && (
              <div className="flex-1 p-6 text-center text-sm text-[var(--color-fg-muted)]">
                <Skeleton className="mx-auto h-4 w-40" />
              </div>
            )}

            {error && (
              <div className="border-b border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-4 py-2 text-xs text-[var(--color-danger)]">
                {error}{' '}
                {error.includes('not_found') && (
                  <a href="/integrations" className="underline">
                    Connect GitHub
                  </a>
                )}
              </div>
            )}

            {accounts.length > 1 && (
              <div className="border-b border-[var(--color-border)] px-4 py-2">
                <div className="flex flex-wrap gap-1">
                  {accounts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAccountId(a.id)}
                      className={`rounded-full px-2.5 py-1 text-xs ${
                        accountId === a.id
                          ? 'bg-[var(--color-brand)] text-white'
                          : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
                      }`}
                    >
                      @{a.login}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {accountId && (
              <div className="border-b border-[var(--color-border)] px-4 py-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your repositories…"
                    className="pl-8"
                    autoFocus
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <ul className="space-y-1 p-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <li key={i}>
                      <Skeleton className="h-12 w-full" />
                    </li>
                  ))}
                </ul>
              )}
              {!loading && repos && repos.length === 0 && (
                <p className="p-6 text-center text-sm text-[var(--color-fg-subtle)]">
                  No repositories match.
                </p>
              )}
              {!loading && repos && repos.length > 0 && (
                <ul className="divide-y divide-[var(--color-border)]">
                  {repos.map((repo) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      projectId={projectId}
                      integrationId={accountId!}
                      alreadyLinked={existingUrls.includes(repo.url)}
                      onAssigned={onClose}
                    />
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RepoRow({
  repo,
  projectId,
  integrationId,
  alreadyLinked,
  onAssigned,
}: {
  repo: GithubRepo;
  projectId: string;
  integrationId: string;
  alreadyLinked: boolean;
  onAssigned: () => void;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const onAssign = () => {
    setErr(null);
    start(async () => {
      const res = await assignGithubRepoAction({ projectId, integrationId, repo });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      onAssigned();
    });
  };
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{repo.fullName}</span>
          {repo.private && (
            <Badge size="xs" variant="warning">
              private
            </Badge>
          )}
          {repo.language && (
            <Badge size="xs" variant="neutral">
              {repo.language}
            </Badge>
          )}
        </div>
        {repo.description && (
          <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{repo.description}</p>
        )}
        {err && <p className="mt-1 text-xs text-[var(--color-danger)]">{err}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
          aria-label="Open on GitHub"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        {alreadyLinked ? (
          <Badge size="xs" variant="success">
            linked
          </Badge>
        ) : (
          <Button size="sm" variant="outline" onClick={onAssign} disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Link
          </Button>
        )}
      </div>
    </li>
  );
}
