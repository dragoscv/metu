'use client';
import { Badge, Button, Input } from '@metu/ui';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Building2,
  Check,
  ExternalLink,
  Github,
  Globe,
  Loader2,
  Lock,
  Plus,
  Save,
  Search,
  Sparkles,
  Star,
  User,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  createGithubRepoAction,
  getGithubRepoByUrlAction,
  listGithubAccountsAction,
  listGithubOwnersAction,
  listGithubReposAction,
  listLinkedGithubReposAction,
  type GithubAccount,
  type GithubOwnerOption,
  type GithubRepo,
  type LinkedGithubRepo,
} from '@/app/actions/github';
import { createProjectAction, createProjectWithGithubRepoAction } from '@/app/actions/project';
import { ColorPicker, StackTagsInput } from './stack-tags-input';

type Source = 'choose' | 'git' | 'blank';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function ProjectStarter({ pinGoalId = null }: { pinGoalId?: string | null } = {}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>('choose');

  // GitHub flow state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenRepo, setChosenRepo] = useState<{ repo: GithubRepo; integrationId: string } | null>(
    null,
  );

  // Confirm-form state (shared between blank + repo paths)
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugDirty, setSlugDirty] = useState(false);
  const [summary, setSummary] = useState('');
  const [stack, setStack] = useState<string[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onName = (v: string) => {
    setName(v);
    if (!slugDirty) setSlug(slugify(v));
  };

  const choose = (s: Source) => {
    setSource(s);
    setError(null);
    if (s === 'git') {
      setPickerOpen(true);
    }
    if (s === 'blank') {
      setChosenRepo(null);
    }
  };

  const onRepoChosen = (repo: GithubRepo, integrationId: string) => {
    setChosenRepo({ repo, integrationId });
    setPickerOpen(false);
    // Prefill form fields from repo metadata.
    onName(repo.name);
    setSlug(slugify(repo.name));
    setSlugDirty(false);
    setSummary(repo.description ?? '');
    setStack(repo.language ? [repo.language] : []);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !slug) {
      setError('Name and slug are required');
      return;
    }
    start(async () => {
      const projectInput = {
        name: name.trim(),
        slug,
        summary: summary.trim() || undefined,
        ...(pinGoalId ? { goalId: pinGoalId } : {}),
        metadata: {
          ...(stack.length > 0 ? { stack } : {}),
          ...(color ? { color } : {}),
        },
      };
      const res = chosenRepo
        ? await createProjectWithGithubRepoAction({
            project: projectInput,
            github: { integrationId: chosenRepo.integrationId, repo: chosenRepo.repo },
          })
        : await createProjectAction(projectInput);
      if (!res.ok) {
        setError(res.error);
        if ('id' in res && res.id) {
          // Project was created but linking failed — still navigate so user can fix.
          router.push(`/projects/${res.id}/edit?welcome=1`);
        }
        return;
      }
      router.push(`/projects/${res.id}/edit?welcome=1`);
    });
  };

  return (
    <div className="space-y-6">
      <SourcePicker source={source} chosenRepo={chosenRepo?.repo ?? null} onChoose={choose} />

      {source === 'git' && chosenRepo && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="text-xs text-[var(--color-fg-muted)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline"
        >
          Pick a different repository
        </button>
      )}

      {(source === 'blank' || (source === 'git' && chosenRepo)) && (
        <form onSubmit={submit} className="space-y-6">
          <Section
            title="Identity"
            subtitle={
              chosenRepo
                ? 'Prefilled from the repository — adjust if needed.'
                : 'Pick a name and a short, lower-case slug for URLs.'
            }
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--color-fg-muted)]">Name</label>
              <Input value={name} onChange={(e) => onName(e.target.value)} autoFocus required />
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--color-fg-muted)]">Slug</label>
                <Input
                  value={slug}
                  onChange={(e) => {
                    setSlug(slugify(e.target.value));
                    setSlugDirty(true);
                  }}
                  required
                  pattern="^[a-z0-9-]+$"
                />
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  Lower-case letters, digits, and hyphens. Used in URLs.
                </p>
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
                placeholder="One sentence — what is this project for?"
              />
            </div>
          </Section>

          <Section
            title="Stack"
            subtitle={
              chosenRepo
                ? `Detected language: ${chosenRepo.repo.language ?? '—'}. Add more tags if you like.`
                : 'Tag the technologies, languages, or domains this project lives in.'
            }
          >
            <StackTagsInput value={stack} onChange={setStack} />
          </Section>

          {chosenRepo && (
            <div className="bg-[var(--color-success-bg)]/40 rounded-md border border-[var(--color-success-border)] p-3 text-xs text-[var(--color-fg-muted)]">
              <Check className="mr-1.5 inline h-3.5 w-3.5 text-[var(--color-success)]" />
              {chosenRepo.repo.fullName} will be linked when the project is created. Push, PR, and
              issue events will route into the project timeline.
            </div>
          )}

          {!chosenRepo && (
            <div className="bg-[var(--color-info-bg)]/40 rounded-md border border-[var(--color-info-border)] p-3 text-xs text-[var(--color-fg-muted)]">
              <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-[var(--color-info)]" />
              You can attach repos, docs, and goals on the next page.
            </div>
          )}

          {error && (
            <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => router.push('/projects')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim() || !slug}>
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Create project
            </Button>
          </div>
        </form>
      )}

      <AnimatePresence>
        {pickerOpen && (
          <RepoSourceModal
            onClose={() => {
              setPickerOpen(false);
              if (!chosenRepo) setSource('choose');
            }}
            onPicked={onRepoChosen}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SourcePicker({
  source,
  chosenRepo,
  onChoose,
}: {
  source: Source;
  chosenRepo: GithubRepo | null;
  onChoose: (s: Source) => void;
}) {
  const cards: Array<{
    id: Source;
    icon: React.ReactNode;
    title: string;
    desc: string;
    badge?: string;
  }> = [
    {
      id: 'git',
      icon: <Github className="h-5 w-5" />,
      title: 'From a Git repository',
      desc: 'Search, create, or paste a GitHub URL. Repo metadata prefills the project.',
      badge: 'Recommended',
    },
    {
      id: 'blank',
      icon: <Sparkles className="h-5 w-5" />,
      title: 'Blank project',
      desc: 'Start without a repo. Useful for research, ops, or non-code work.',
    },
  ];

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-fg-muted)]">
        How does this project start?
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((c) => {
          const active = source === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChoose(c.id)}
              className={`group relative cursor-pointer rounded-xl border p-4 text-left transition ${
                active
                  ? 'border-[var(--color-brand)] bg-[var(--color-bg-card)] ring-1 ring-[var(--color-brand)]'
                  : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                    active
                      ? 'bg-[var(--color-brand)] text-white'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)]'
                  }`}
                >
                  {c.icon}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{c.title}</h3>
                    {c.badge && (
                      <Badge size="xs" variant="brand">
                        {c.badge}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{c.desc}</p>
                  {active && c.id === 'git' && chosenRepo && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-success-bg)] px-2 py-1 text-[11px] text-[var(--color-success)]">
                      <Check className="h-3 w-3" />
                      {chosenRepo.fullName}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
    <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <header>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">{subtitle}</p>}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// ----------------- Repo source modal -----------------

type Tab = 'search' | 'create' | 'url';

function RepoSourceModal({
  onClose,
  onPicked,
}: {
  onClose: () => void;
  onPicked: (repo: GithubRepo, integrationId: string) => void;
}) {
  const [accounts, setAccounts] = useState<GithubAccount[] | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, GithubOwnerOption[] | 'loading' | 'error'>>(
    {},
  );
  const [ownerLogin, setOwnerLogin] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('search');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listGithubAccountsAction();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setAccounts([]);
        return;
      }
      setAccounts(res.accounts);
      if (res.accounts[0]) setAccountId(res.accounts[0].id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load owners (user + orgs) whenever the account changes.
  useEffect(() => {
    if (!accountId) return;
    if (owners[accountId] && owners[accountId] !== 'error') {
      // Already cached — make sure ownerLogin is valid for this account.
      const cached = owners[accountId];
      if (Array.isArray(cached)) {
        const stillValid = cached.some((o) => o.login === ownerLogin);
        if (!stillValid) setOwnerLogin(cached[0]?.login ?? null);
      }
      return;
    }
    let cancelled = false;
    setOwners((prev) => ({ ...prev, [accountId]: 'loading' }));
    (async () => {
      const res = await listGithubOwnersAction({ integrationId: accountId });
      if (cancelled) return;
      if (!res.ok) {
        setOwners((prev) => ({ ...prev, [accountId]: 'error' }));
        // Fallback: pick the account login if available.
        const acc = accounts?.find((a) => a.id === accountId);
        if (acc) setOwnerLogin(acc.login);
        return;
      }
      setOwners((prev) => ({ ...prev, [accountId]: res.owners }));
      setOwnerLogin(res.owners[0]?.login ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isLoading = accounts === null;
  const noAccount = accounts !== null && accounts.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        className="flex h-[min(640px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Pick a Git repository</h2>
            <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
              Search your repos, create a new one, or paste a URL.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center px-5 py-12">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-fg-muted)]" />
          </div>
        ) : noAccount ? (
          <ConnectGithubCta />
        ) : (
          <>
            {accountId && (
              <AccountSummary accounts={accounts} accountId={accountId} onPick={setAccountId} />
            )}

            <div className="flex border-b border-[var(--color-border)] px-5">
              {(
                [
                  { id: 'search', label: 'Search existing', icon: Search },
                  { id: 'create', label: 'Create new', icon: Plus },
                  { id: 'url', label: 'From URL', icon: ExternalLink },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                      active
                        ? 'text-[var(--color-fg)]'
                        : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                    {active && (
                      <motion.span
                        layoutId="repo-tab-underline"
                        className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--color-brand)]"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {accountId && (tab === 'search' || tab === 'create') && (
              <OwnerStrip
                state={owners[accountId] ?? 'loading'}
                ownerLogin={ownerLogin}
                onPick={setOwnerLogin}
                variant="body"
                requireOrgSelection={tab === 'create'}
              />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {error && (
                <div className="mb-3 rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  {error}
                </div>
              )}
              {tab === 'search' && accountId && (
                <SearchTab
                  integrationId={accountId}
                  owner={ownerLogin}
                  onPick={(r) => onPicked(r, accountId)}
                />
              )}
              {tab === 'create' && accountId && (
                <CreateTab
                  integrationId={accountId}
                  owner={ownerLogin}
                  ownerKind={
                    Array.isArray(owners[accountId])
                      ? ((owners[accountId] as GithubOwnerOption[]).find(
                          (o) => o.login === ownerLogin,
                        )?.kind ?? 'user')
                      : 'user'
                  }
                  onCreated={(r) => onPicked(r, accountId)}
                  setError={setError}
                />
              )}
              {tab === 'url' && (
                <UrlTab onResolved={(r, intId) => onPicked(r, intId)} setError={setError} />
              )}
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function ConnectGithubCta() {
  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--color-bg-elevated)]">
        <Github className="h-6 w-6 text-[var(--color-fg-muted)]" />
      </div>
      <h3 className="text-sm font-semibold">Connect GitHub to continue</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--color-fg-muted)]">
        Once connected, you&apos;ll be able to search your repositories, create new ones, and link
        them to projects.
      </p>
      <Link
        href="/integrations"
        className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-4 text-sm font-medium text-white hover:opacity-90"
      >
        <Github className="h-4 w-4" />
        Connect GitHub
      </Link>
    </div>
  );
}

function AccountSummary({
  accounts,
  accountId,
  onPick,
}: {
  accounts: GithubAccount[];
  accountId: string;
  onPick: (id: string) => void;
}) {
  if (accounts.length > 1) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-5 py-2">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          Account
        </span>
        {accounts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onPick(a.id)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition ${
              accountId === a.id
                ? 'bg-[var(--color-bg-elevated)] text-[var(--color-fg)] ring-1 ring-[var(--color-brand)]'
                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]'
            }`}
          >
            <Github className="h-3.5 w-3.5" />
            {a.label}
          </button>
        ))}
      </div>
    );
  }
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return null;
  return (
    <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-2 text-[11px] text-[var(--color-fg-subtle)]">
      <Github className="h-3 w-3" />
      <span>
        Account: <span className="font-medium text-[var(--color-fg)]">{acc.label}</span>
      </span>
    </div>
  );
}

function OwnerStrip({
  state,
  ownerLogin,
  onPick,
  variant,
  requireOrgSelection,
}: {
  state: GithubOwnerOption[] | 'loading' | 'error';
  ownerLogin: string | null;
  onPick: (login: string) => void;
  variant: 'account' | 'body';
  requireOrgSelection?: boolean;
}) {
  const wrapperClass =
    variant === 'body'
      ? 'flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)]/40 px-5 py-2'
      : 'flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-5 py-2';
  if (state === 'loading') {
    return (
      <div className={`${wrapperClass} text-[11px] text-[var(--color-fg-subtle)]`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading organizations…
      </div>
    );
  }
  if (state === 'error' || state.length === 0) return null;
  // Skip when there are no orgs to choose between.
  if (state.length === 1) return null;
  return (
    <div className={wrapperClass}>
      <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
        {requireOrgSelection ? 'Create under' : 'Owner'}
      </span>
      {state.map((o) => {
        const active = ownerLogin === o.login;
        const Icon = o.kind === 'org' ? Building2 : User;
        return (
          <button
            key={o.login}
            type="button"
            onClick={() => onPick(o.login)}
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition ${
              active
                ? 'bg-[var(--color-bg-card)] text-[var(--color-fg)] ring-1 ring-[var(--color-brand)]'
                : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]'
            }`}
          >
            {o.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={o.avatarUrl}
                alt=""
                className="h-4 w-4 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            <span>{o.login}</span>
            {o.kind === 'org' && (
              <span className="text-[9px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                org
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SearchTab({
  integrationId,
  owner,
  onPick,
}: {
  integrationId: string;
  owner: string | null;
  onPick: (repo: GithubRepo) => void;
}) {
  const [q, setQ] = useState('');
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linkedMap, setLinkedMap] = useState<Map<string, LinkedGithubRepo>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listLinkedGithubReposAction();
      if (cancelled || !res.ok) return;
      const map = new Map<string, LinkedGithubRepo>();
      for (const l of res.linked) map.set(l.fullName.toLowerCase(), l);
      setLinkedMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    const t = setTimeout(async () => {
      const res = await listGithubReposAction({
        integrationId,
        search: q.trim() || undefined,
        perPage: 50,
        owner: owner ?? undefined,
      });
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setErr(res.error);
        setRepos([]);
        return;
      }
      setRepos(res.repos);
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [integrationId, owner, q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-fg-muted)]" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search repositories…"
          className="pl-8"
          autoFocus
        />
      </div>
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
      <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)]">
        {loading && (
          <li className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-fg-muted)]" />
          </li>
        )}
        {!loading && repos && repos.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-[var(--color-fg-subtle)]">
            No repositories found.
          </li>
        )}
        {!loading &&
          repos?.map((r) => {
            const linked = linkedMap.get(r.fullName.toLowerCase());
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r)}
                  className="flex w-full cursor-pointer items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-card)] focus-visible:bg-[var(--color-bg-card)] focus-visible:outline-none"
                >
                  <Github className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-fg-muted)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{r.fullName}</span>
                      {linked && (
                        <Badge
                          size="xs"
                          variant="success"
                          title={`Already linked to ${linked.projectName}`}
                        >
                          <Check className="h-2.5 w-2.5" />
                          Linked · {linked.projectName}
                        </Badge>
                      )}
                      {r.private && (
                        <Badge size="xs" variant="warning">
                          <Lock className="h-2.5 w-2.5" />
                          private
                        </Badge>
                      )}
                      {r.language && (
                        <Badge size="xs" variant="neutral">
                          {r.language}
                        </Badge>
                      )}
                      {r.stars > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[var(--color-fg-subtle)]">
                          <Star className="h-2.5 w-2.5" />
                          {r.stars}
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-fg-muted)]">
                        {r.description}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
      </ul>
    </div>
  );
}

function CreateTab({
  integrationId,
  owner,
  ownerKind,
  onCreated,
  setError,
}: {
  integrationId: string;
  owner: string | null;
  ownerKind: 'user' | 'org';
  onCreated: (repo: GithubRepo) => void;
  setError: (e: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [autoInit, setAutoInit] = useState(true);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createGithubRepoAction({
        integrationId,
        name: name.trim(),
        description: description.trim() || undefined,
        private: isPrivate,
        autoInit,
        owner: owner ?? undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.repo);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Repository name</label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-new-repo"
          pattern="^[A-Za-z0-9._-]{1,100}$"
          required
          autoFocus
        />
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Letters, digits, dot, dash, underscore. Created under{' '}
          <span className="font-medium text-[var(--color-fg)]">{owner ?? 'your user'}</span> (
          {ownerKind === 'org' ? 'organization' : 'personal'}).
        </p>
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">
          Description (optional)
        </label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One sentence about the repo"
        />
      </div>
      <div className="flex flex-wrap gap-4 pt-1 text-xs">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
          />
          <Lock className="h-3 w-3" />
          Private
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoInit}
            onChange={(e) => setAutoInit(e.target.checked)}
            className="h-3.5 w-3.5 accent-[var(--color-brand)]"
          />
          Initialize with README
        </label>
      </div>
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create repository
        </Button>
      </div>
    </form>
  );
}

function UrlTab({
  onResolved,
  setError,
}: {
  onResolved: (repo: GithubRepo, integrationId: string) => void;
  setError: (e: string | null) => void;
}) {
  const [url, setUrl] = useState('');
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await getGithubRepoByUrlAction({ url: url.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onResolved(res.repo, res.integrationId);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">
          GitHub repository URL
        </label>
        <div className="relative">
          <Globe className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[var(--color-fg-muted)]" />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            type="url"
            required
            autoFocus
            className="pl-8"
          />
        </div>
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Must be accessible by one of your connected GitHub accounts.
        </p>
      </div>
      <div className="flex justify-end pt-1">
        <Button type="submit" disabled={pending || !url.trim()}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowLeft className="hidden" />
          )}
          Use this repository
        </Button>
      </div>
    </form>
  );
}
