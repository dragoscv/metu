import { auth } from '@metu/auth';
import { listProjects } from '@metu/db/queries';
import { Badge, Card, CardTitle, EmptyState, Page, PageHeader } from '@metu/ui';
import { ExternalLink, GitCommit, GitPullRequest, MessageSquare, Star } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getGithubRepoDetailAction } from '@/app/actions/github';
import { GithubRepoActions } from '@/components/integrations/github-repo-actions';

interface PageProps {
  params: Promise<{ owner: string; repo: string }>;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function GithubRepoPage({ params }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');
  const { owner, repo } = await params;

  const [detail, projects] = await Promise.all([
    getGithubRepoDetailAction({ owner, repo }),
    listProjects(session.user.workspaceId),
  ]);

  const fullName = `${owner}/${repo}`;
  const projectOptions = projects
    .filter((p) => p.status !== 'archived' && p.status !== 'killed')
    .map((p) => ({ id: p.id, name: p.name, slug: p.slug }));

  if (!detail.ok) {
    return (
      <Page className="mx-auto max-w-3xl">
        <PageHeader
          size="sm"
          back={{ href: '/integrations/github', label: 'GitHub' }}
          title={fullName}
        />
        <EmptyState
          icon={<ExternalLink className="h-5 w-5" />}
          title="Couldn't load repository"
          description={detail.error}
        />
      </Page>
    );
  }

  const { detail: data, linkedProjectId, integrationId } = detail;
  const linkedProject = linkedProjectId
    ? projectOptions.find((p) => p.id === linkedProjectId)
    : null;

  return (
    <Page className="mx-auto max-w-4xl">
      <PageHeader
        size="sm"
        back={{ href: '/integrations/github', label: 'GitHub' }}
        title={data.repo.fullName}
        description={data.repo.description ?? undefined}
        eyebrow={
          <div className="flex flex-wrap items-center gap-1.5">
            {data.repo.private && (
              <Badge size="xs" variant="warning">
                private
              </Badge>
            )}
            {data.repo.fork && (
              <Badge size="xs" variant="neutral">
                fork
              </Badge>
            )}
            {data.repo.archived && (
              <Badge size="xs" variant="neutral">
                archived
              </Badge>
            )}
            {data.repo.language && (
              <Badge size="xs" variant="neutral">
                {data.repo.language}
              </Badge>
            )}
            {data.repo.stars > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--color-fg-subtle)]">
                <Star className="h-3 w-3" />
                {data.repo.stars}
              </span>
            )}
          </div>
        }
        actions={
          <a
            href={data.repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-bg-elevated)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open on GitHub
          </a>
        }
      />

      <GithubRepoActions
        owner={owner}
        repo={repo}
        integrationId={integrationId}
        linkedProjectId={linkedProjectId}
        linkedProjectName={linkedProject?.name ?? null}
        projects={projectOptions}
        repoMeta={{
          id: data.repo.id,
          fullName: data.repo.fullName,
          name: data.repo.name,
          owner: data.repo.owner,
          description: data.repo.description,
          private: data.repo.private,
          url: data.repo.url,
          language: data.repo.language,
          defaultBranch: data.repo.defaultBranch,
          stars: data.repo.stars,
          pushedAt: data.repo.pushedAt,
          ownerAvatarUrl: data.repo.ownerAvatarUrl,
          fork: data.repo.fork,
          archived: data.repo.archived,
        }}
        issuesCount={data.issues.length}
        pullsCount={data.pulls.length}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardTitle>Default branch</CardTitle>
          <p className="mt-1 font-mono text-sm">{data.repo.defaultBranch}</p>
        </Card>
        <Card>
          <CardTitle>Last push</CardTitle>
          <p className="mt-1 text-sm">{relativeTime(data.repo.pushedAt)}</p>
        </Card>
        <Card>
          <CardTitle>Open</CardTitle>
          <div className="mt-1 flex gap-3 text-sm">
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {data.issues.length} issues
            </span>
            <span className="inline-flex items-center gap-1">
              <GitPullRequest className="h-3.5 w-3.5" />
              {data.pulls.length} PRs
            </span>
          </div>
        </Card>
      </div>

      <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
        <header className="mb-3 flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-[var(--color-fg-muted)]" />
          <h2 className="text-sm font-semibold">Recent commits</h2>
          <Badge size="xs" variant="neutral">
            {data.commits.length}
          </Badge>
        </header>
        {data.commits.length === 0 ? (
          <p className="text-xs text-[var(--color-fg-subtle)]">No commits returned.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {data.commits.map((c) => (
              <li key={c.sha} className="flex items-start gap-3 py-2 text-sm">
                <code className="mt-0.5 shrink-0 rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-fg-muted)]">
                  {c.sha.slice(0, 7)}
                </code>
                <div className="min-w-0 flex-1">
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="line-clamp-1 hover:underline"
                  >
                    {c.message.split('\n')[0]}
                  </a>
                  <p className="text-[11px] text-[var(--color-fg-subtle)]">
                    {c.author.login ?? 'unknown'} · {relativeTime(c.author.date)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <IssueList
          icon={<MessageSquare className="h-4 w-4 text-[var(--color-fg-muted)]" />}
          title="Open issues"
          items={data.issues}
        />
        <IssueList
          icon={<GitPullRequest className="h-4 w-4 text-[var(--color-fg-muted)]" />}
          title="Open pull requests"
          items={data.pulls}
        />
      </div>

      {!linkedProject && (
        <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 text-center text-xs text-[var(--color-fg-subtle)]">
          Not linked to any project yet. Use the controls above to link this repo so its events and
          issues route into a project.
        </p>
      )}
    </Page>
  );
}

function IssueList({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: Array<{
    number: number;
    title: string;
    url: string;
    user: string | null;
    labels: string[];
    updatedAt: string;
  }>;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        <Badge size="xs" variant="neutral">
          {items.length}
        </Badge>
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-[var(--color-fg-subtle)]">None open.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {items.slice(0, 12).map((i) => (
            <li key={i.number} className="py-2 text-sm">
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-1 hover:underline"
              >
                <span className="text-[var(--color-fg-muted)]">#{i.number}</span> {i.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-fg-subtle)]">
                <span>{i.user ?? '—'}</span>
                <span>·</span>
                <span>{new Date(i.updatedAt).toLocaleDateString()}</span>
                {i.labels.slice(0, 3).map((l) => (
                  <Badge key={l} size="xs" variant="outline">
                    {l}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
