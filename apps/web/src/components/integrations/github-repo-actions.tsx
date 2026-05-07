'use client';
import { Badge, Button, Select } from '@metu/ui';
import { CheckCircle2, Download, Link2, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  assignGithubRepoAction,
  importGithubIssuesAction,
  type GithubRepo,
} from '@/app/actions/github';
import { removeProjectLinkByUrlAction } from '@/app/actions/project-links';

interface ProjectOption {
  id: string;
  name: string;
  slug: string;
}

export function GithubRepoActions({
  owner,
  repo,
  integrationId,
  linkedProjectId,
  linkedProjectName,
  projects,
  repoMeta,
  issuesCount,
  pullsCount,
}: {
  owner: string;
  repo: string;
  integrationId: string;
  linkedProjectId: string | null;
  linkedProjectName: string | null;
  projects: ProjectOption[];
  repoMeta: GithubRepo;
  issuesCount: number;
  pullsCount: number;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>(linkedProjectId ?? projects[0]?.id ?? '');
  const [importIssues, setImportIssues] = useState(true);
  const [importPulls, setImportPulls] = useState(false);
  const [pendingLink, startLink] = useTransition();
  const [pendingImport, startImport] = useTransition();
  const [pendingUnlink, startUnlink] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ imported: number; skipped: number } | null>(null);

  const onLink = () => {
    if (!projectId) return;
    setError(null);
    startLink(async () => {
      const res = await assignGithubRepoAction({ projectId, integrationId, repo: repoMeta });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const onUnlink = () => {
    if (!linkedProjectId) return;
    if (!confirm(`Unlink ${repoMeta.fullName} from project?`)) return;
    setError(null);
    startUnlink(async () => {
      const r = await removeProjectLinkByUrlAction({
        projectId: linkedProjectId,
        url: repoMeta.url,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  const onImport = () => {
    if (!linkedProjectId) return;
    if (!importIssues && !importPulls) return;
    setError(null);
    setImported(null);
    startImport(async () => {
      const res = await importGithubIssuesAction({
        projectId: linkedProjectId,
        owner,
        repo,
        kinds: { issues: importIssues, pulls: importPulls },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setImported({ imported: res.imported, skipped: res.skipped });
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Project link</h2>
          <p className="mt-0.5 text-xs text-[var(--color-fg-muted)]">
            Linked repos route push, PR, and issue events into the project timeline. You can also
            import open issues and PRs as tasks.
          </p>
        </div>
        {linkedProjectName && (
          <Badge size="sm" variant="success">
            <CheckCircle2 className="h-3 w-3" />
            Linked to {linkedProjectName}
          </Badge>
        )}
      </header>

      {!linkedProjectId ? (
        <div className="flex flex-wrap items-center gap-2">
          {projects.length === 0 ? (
            <p className="text-xs text-[var(--color-fg-subtle)]">
              No projects available. Create one first.
            </p>
          ) : (
            <>
              <Select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="h-8 w-56 text-xs"
                aria-label="Project to link to"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="default"
                onClick={onLink}
                disabled={pendingLink || !projectId}
              >
                {pendingLink ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Link to project
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
            <p className="text-xs font-medium">Import open work as tasks</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={importIssues}
                  onChange={(e) => setImportIssues(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                />
                Issues ({issuesCount})
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={importPulls}
                  onChange={(e) => setImportPulls(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-brand)]"
                />
                Pull requests ({pullsCount})
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={onImport}
                disabled={pendingImport || (!importIssues && !importPulls)}
              >
                {pendingImport ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Import as tasks
              </Button>
              {imported && (
                <span className="text-[var(--color-success)]">
                  Imported {imported.imported}
                  {imported.skipped > 0 && ` (${imported.skipped} skipped — already imported)`}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-[var(--color-fg-subtle)]">
              Tasks are deduplicated by issue/PR number. Re-running only adds new ones.
            </p>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={onUnlink} disabled={pendingUnlink}>
              {pendingUnlink ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Unlink
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
