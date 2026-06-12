/**
 * GitHub webhook receiver.
 *
 * One endpoint, HMAC-verified, that fans every supported `x-github-event`
 * into `timeline_event` rows for every project linked to the repo. The
 * webhook also kicks an immediate `github/stats.sync.repo` so the
 * dashboard reflects the new push within seconds (instead of waiting up
 * to 2h for the cron).
 *
 * Supported events: push, create, delete, pull_request,
 * pull_request_review, pull_request_review_comment, commit_comment,
 * issues, issue_comment, discussion, discussion_comment, release,
 * workflow_run, check_run, deployment_status, star, fork, member.
 *
 * Branch handling: `push` events carry a `ref` like `refs/heads/<branch>`
 * (or `refs/tags/<tag>`); we extract it, surface in the title when not the
 * default branch, and persist in `payload.branch` so the Conductor can
 * filter / weight by branch.
 */
import { NextResponse } from 'next/server';
import { github } from '@metu/integrations';
import { getDb } from '@metu/db';
import { integrationResource, projectLink, timelineEvent } from '@metu/db/schema';
import { projectsByGithubRepoGlobal } from '@metu/db/queries';
import { and, eq } from 'drizzle-orm';
import { inngest } from '@/inngest/client';

interface PushCommit {
  id?: string;
  message?: string;
  url?: string;
  author?: { name?: string; username?: string; email?: string };
  added?: string[];
  removed?: string[];
  modified?: string[];
}

export interface RepoPayload {
  repository?: { full_name?: string; default_branch?: string };
  action?: string;
  sender?: { login?: string };
  ref?: string;
  ref_type?: string;
  master_branch?: string;
  before?: string;
  after?: string;
  forced?: boolean;
  created?: boolean;
  deleted?: boolean;
  distinct_size?: number;
  size?: number;
  head_commit?: {
    id?: string;
    message?: string;
    url?: string;
    author?: { name?: string; username?: string };
  };
  pull_request?: {
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
    head?: { ref?: string };
    base?: { ref?: string };
    merged?: boolean;
    draft?: boolean;
    additions?: number;
    deletions?: number;
    changed_files?: number;
  };
  review?: { state?: string; html_url?: string; user?: { login?: string }; body?: string };
  comment?: { body?: string; html_url?: string; user?: { login?: string }; commit_id?: string };
  issue?: {
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
    pull_request?: unknown;
  };
  discussion?: {
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
    category?: { name?: string };
  };
  release?: {
    name?: string;
    tag_name?: string;
    html_url?: string;
    prerelease?: boolean;
    draft?: boolean;
  };
  workflow_run?: {
    name?: string;
    conclusion?: string | null;
    status?: string;
    html_url?: string;
    head_branch?: string;
    event?: string;
    run_number?: number;
    run_started_at?: string;
    created_at?: string;
    updated_at?: string;
  };
  check_run?: {
    name?: string;
    conclusion?: string | null;
    status?: string;
    html_url?: string;
    head_sha?: string;
  };
  deployment?: { environment?: string; sha?: string; ref?: string };
  deployment_status?: { state?: string; environment?: string; target_url?: string };
  starred_at?: string;
  forkee?: { full_name?: string; html_url?: string };
  member?: { login?: string };
  commits?: PushCommit[];
  security_advisory?: {
    ghsa_id?: string;
    summary?: string;
    severity?: string;
    cve_id?: string | null;
    references?: Array<{ url?: string }>;
  };
  alert?: {
    number?: number;
    state?: string;
    severity?: string;
    summary?: string;
    package?: { name?: string; ecosystem?: string };
    security_advisory?: { ghsa_id?: string; summary?: string; severity?: string };
    security_vulnerability?: { severity?: string; package?: { name?: string } };
    html_url?: string;
  };
}

interface RoutedEvent {
  kind: string;
  title: string;
  importance: number;
  payload: Record<string, unknown>;
  /** Optional anchor for `occurred_at`; defaults to now when omitted. */
  occurredAt?: Date;
}

/** Pull `<branch>` out of `refs/heads/<branch>` (or null for tags / unknown). */
function branchFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
  return null;
}

function tagFromRef(ref: string | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('refs/tags/')) return ref.slice('refs/tags/'.length);
  return null;
}

/**
 * Map a webhook payload to one or more `timeline_event` rows.
 *
 * `push` is the only event that fans out: when a single push contains
 * ≤ 20 distinct commits, each commit gets its own `commit.pushed` row
 * (matching the polling sync's kind, so SHA dedup naturally works
 * across both ingestion paths). Larger pushes collapse to a single
 * `github.push` summary row to avoid timeline spam.
 *
 * Returns `null` for events we intentionally ignore.
 */
export function describe(event: string, body: RepoPayload): RoutedEvent | RoutedEvent[] | null {
  const repo = body.repository?.full_name ?? 'unknown';
  const sender = body.sender?.login ?? 'unknown';
  const defaultBranch = body.repository?.default_branch ?? null;

  switch (event) {
    case 'push': {
      const commits = body.commits ?? [];
      const branch = branchFromRef(body.ref);
      const tag = tagFromRef(body.ref);
      // Tag pushes are emitted as a separate kind so they don't pollute
      // commit-velocity metrics.
      if (tag) {
        return {
          kind: 'github.tag.pushed',
          title: `${sender} pushed tag ${tag} on ${repo}`.slice(0, 240),
          importance: 0.6,
          payload: {
            provider: 'github',
            event,
            repo,
            tag,
            sender,
            before: body.before,
            after: body.after,
          },
        };
      }
      if (commits.length === 0) {
        // Branch ref update with no commits (e.g. force-push to identical sha).
        return null;
      }
      const first = body.head_commit?.message ?? commits[0]?.message ?? '';
      const branchTag = branch && branch !== defaultBranch ? ` [${branch}]` : '';
      const distinct = body.distinct_size ?? commits.length;
      const isDefaultBranch = branch === defaultBranch;
      const baseImportance = isDefaultBranch ? 0.55 : 0.45;

      // Small batches: fan out per-commit rows so each commit becomes
      // an independently-clickable timeline item. Force-pushes still
      // collapse to a summary (commits may have been re-written).
      if (distinct > 0 && distinct <= 20 && body.forced !== true) {
        return commits.slice(0, 20).map((c) => ({
          kind: 'commit.pushed',
          title:
            `${c.author?.username ?? c.author?.name ?? sender} on ${repo}${branchTag}: ${((c.message ?? '').split('\n')[0] ?? '').slice(0, 180)}`.slice(
              0,
              240,
            ),
          importance: baseImportance,
          payload: {
            provider: 'github',
            event,
            repo,
            branch,
            isDefaultBranch,
            sha: c.id,
            message: c.message ?? null,
            url: c.url ?? null,
            author: c.author?.username ?? c.author?.name ?? null,
            added: c.added?.length ?? 0,
            removed: c.removed?.length ?? 0,
            modified: c.modified?.length ?? 0,
          },
        }));
      }

      return {
        kind: 'github.push',
        title:
          `${sender} pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${repo}${branchTag}: ${first.split('\n')[0]}`.slice(
            0,
            240,
          ),
        // Pushes outside the default branch are weighted slightly lower;
        // they're useful signal but rarely the most important thing today.
        importance: baseImportance,
        payload: {
          provider: 'github',
          event,
          repo,
          branch,
          isDefaultBranch,
          commits: commits.length,
          distinctCommits: distinct,
          forced: body.forced === true,
          created: body.created === true,
          deleted: body.deleted === true,
          before: body.before,
          after: body.after,
          sender,
          headCommit: body.head_commit
            ? {
                sha: body.head_commit.id,
                message: body.head_commit.message,
                url: body.head_commit.url,
                author: body.head_commit.author?.username ?? body.head_commit.author?.name ?? null,
              }
            : null,
          // Cap inline commit list at 20; rest are addressable via `before..after`.
          commitList: commits.slice(0, 20).map((c) => ({
            sha: c.id,
            message: (c.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
            url: c.url,
            author: c.author?.username ?? c.author?.name ?? null,
            added: c.added?.length ?? 0,
            removed: c.removed?.length ?? 0,
            modified: c.modified?.length ?? 0,
          })),
        },
      };
    }
    case 'create': {
      const refType = body.ref_type ?? 'ref';
      return {
        kind: `github.${refType}.created`,
        title: `${sender} created ${refType} ${body.ref} on ${repo}`.slice(0, 240),
        importance: refType === 'tag' ? 0.6 : 0.4,
        payload: { provider: 'github', event, repo, refType, ref: body.ref, sender },
      };
    }
    case 'delete': {
      const refType = body.ref_type ?? 'ref';
      return {
        kind: `github.${refType}.deleted`,
        title: `${sender} deleted ${refType} ${body.ref} on ${repo}`.slice(0, 240),
        importance: 0.35,
        payload: { provider: 'github', event, repo, refType, ref: body.ref, sender },
      };
    }
    case 'pull_request': {
      const pr = body.pull_request;
      if (!pr) return null;
      const action = body.action ?? 'updated';
      const merged = action === 'closed' && pr.merged === true;
      const kind = merged ? 'github.pr.merged' : `github.pr.${action}`;
      const importance = merged
        ? 0.75
        : action === 'opened'
          ? 0.65
          : action === 'closed'
            ? 0.55
            : 0.4;
      return {
        kind,
        title: `${repo} · PR #${pr.number} ${merged ? 'merged' : action}: ${pr.title ?? ''}`.slice(
          0,
          240,
        ),
        importance,
        payload: {
          provider: 'github',
          event,
          action,
          repo,
          number: pr.number,
          url: pr.html_url,
          sender: pr.user?.login,
          merged,
          draft: pr.draft === true,
          headBranch: pr.head?.ref ?? null,
          baseBranch: pr.base?.ref ?? null,
          additions: pr.additions ?? null,
          deletions: pr.deletions ?? null,
          changedFiles: pr.changed_files ?? null,
        },
      };
    }
    case 'pull_request_review': {
      const pr = body.pull_request;
      const review = body.review;
      if (!pr || !review) return null;
      const state = review.state ?? 'commented';
      // approved / changes_requested are higher signal than commented.
      const importance = state === 'approved' ? 0.7 : state === 'changes_requested' ? 0.7 : 0.45;
      return {
        kind: `github.pr.review.${state}`,
        title:
          `${repo} · PR #${pr.number} review ${state} by ${review.user?.login ?? 'unknown'}`.slice(
            0,
            240,
          ),
        importance,
        payload: {
          provider: 'github',
          event,
          repo,
          number: pr.number,
          state,
          reviewer: review.user?.login ?? null,
          url: review.html_url ?? pr.html_url,
        },
      };
    }
    case 'pull_request_review_comment': {
      const pr = body.pull_request;
      const c = body.comment;
      if (!pr || !c) return null;
      return {
        kind: 'github.pr.review_comment',
        title: `${repo} · PR #${pr.number} comment by ${c.user?.login ?? 'unknown'}`.slice(0, 240),
        importance: 0.4,
        payload: {
          provider: 'github',
          event,
          repo,
          number: pr.number,
          author: c.user?.login ?? null,
          url: c.html_url,
        },
      };
    }
    case 'commit_comment': {
      const c = body.comment;
      if (!c) return null;
      return {
        kind: 'github.commit.commented',
        title:
          `${repo} · commit ${(c.commit_id ?? '').slice(0, 7)} comment by ${c.user?.login ?? 'unknown'}`.slice(
            0,
            240,
          ),
        importance: 0.4,
        payload: {
          provider: 'github',
          event,
          repo,
          commitId: c.commit_id ?? null,
          author: c.user?.login ?? null,
          url: c.html_url,
        },
      };
    }
    case 'issues': {
      const issue = body.issue;
      if (!issue) return null;
      const action = body.action ?? 'updated';
      return {
        kind: `github.issue.${action}`,
        title: `${repo} · Issue #${issue.number} ${action}: ${issue.title ?? ''}`.slice(0, 240),
        importance: action === 'opened' ? 0.65 : action === 'closed' ? 0.55 : 0.4,
        payload: {
          provider: 'github',
          event,
          action,
          repo,
          number: issue.number,
          url: issue.html_url,
          sender: issue.user?.login,
        },
      };
    }
    case 'issue_comment': {
      const issue = body.issue;
      const c = body.comment;
      if (!issue || !c) return null;
      const isPr = issue.pull_request !== undefined && issue.pull_request !== null;
      return {
        kind: isPr ? 'github.pr.commented' : 'github.issue.commented',
        title:
          `${repo} · ${isPr ? 'PR' : 'Issue'} #${issue.number} comment by ${c.user?.login ?? 'unknown'}`.slice(
            0,
            240,
          ),
        importance: 0.4,
        payload: {
          provider: 'github',
          event,
          repo,
          number: issue.number,
          author: c.user?.login ?? null,
          url: c.html_url,
        },
      };
    }
    case 'discussion': {
      const d = body.discussion;
      if (!d) return null;
      const action = body.action ?? 'updated';
      return {
        kind: `github.discussion.${action}`,
        title: `${repo} · Discussion #${d.number} ${action}: ${d.title ?? ''}`.slice(0, 240),
        importance: 0.45,
        payload: {
          provider: 'github',
          event,
          action,
          repo,
          number: d.number,
          category: d.category?.name ?? null,
          url: d.html_url,
          sender: d.user?.login,
        },
      };
    }
    case 'discussion_comment': {
      const d = body.discussion;
      const c = body.comment;
      if (!d || !c) return null;
      return {
        kind: 'github.discussion.commented',
        title: `${repo} · Discussion #${d.number} comment by ${c.user?.login ?? 'unknown'}`.slice(
          0,
          240,
        ),
        importance: 0.4,
        payload: {
          provider: 'github',
          event,
          repo,
          number: d.number,
          author: c.user?.login ?? null,
          url: c.html_url,
        },
      };
    }
    case 'release': {
      const r = body.release;
      if (!r) return null;
      const action = body.action ?? 'updated';
      return {
        kind: `github.release.${action}`,
        title: `${repo} · release ${r.tag_name ?? r.name ?? ''} ${action}`.slice(0, 240),
        importance: action === 'published' ? 0.85 : 0.6,
        payload: {
          provider: 'github',
          event,
          action,
          repo,
          tag: r.tag_name ?? null,
          name: r.name ?? null,
          prerelease: r.prerelease === true,
          draft: r.draft === true,
          url: r.html_url ?? null,
        },
      };
    }
    case 'workflow_run': {
      const w = body.workflow_run;
      if (!w) return null;
      // Only emit terminal states — running/queued spam is not useful.
      if (w.status !== 'completed') return null;
      const failed = w.conclusion === 'failure' || w.conclusion === 'timed_out';
      const isDefault = w.head_branch === defaultBranch;
      // Failed default-branch CI is a high-signal interrupt.
      const importance = failed ? (isDefault ? 0.8 : 0.55) : 0.3;
      // Approximate run minutes from start → completion timestamps.
      const startedAt = w.run_started_at ?? w.created_at ?? null;
      const completedAt = w.updated_at ?? null;
      const durationSec =
        startedAt && completedAt
          ? Math.max(
              0,
              Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000),
            )
          : null;
      return {
        kind: failed ? 'github.workflow.failed' : 'github.workflow.succeeded',
        title:
          `${repo} · ${w.name ?? 'workflow'} #${w.run_number ?? '?'} ${w.conclusion ?? 'completed'} on ${w.head_branch ?? 'unknown'}`.slice(
            0,
            240,
          ),
        importance,
        payload: {
          provider: 'github',
          event,
          repo,
          workflow: w.name ?? null,
          conclusion: w.conclusion ?? null,
          branch: w.head_branch ?? null,
          isDefaultBranch: isDefault,
          runNumber: w.run_number ?? null,
          url: w.html_url ?? null,
          durationSec,
          startedAt,
          completedAt,
        },
      };
    }
    case 'check_run': {
      const c = body.check_run;
      if (!c) return null;
      if (c.status !== 'completed') return null;
      const failed = c.conclusion === 'failure' || c.conclusion === 'timed_out';
      // Don't double-count successful checks (workflow_run already covered).
      if (!failed) return null;
      return {
        kind: 'github.check.failed',
        title: `${repo} · check ${c.name ?? 'unknown'} ${c.conclusion ?? 'failed'}`.slice(0, 240),
        importance: 0.55,
        payload: {
          provider: 'github',
          event,
          repo,
          check: c.name ?? null,
          conclusion: c.conclusion ?? null,
          headSha: c.head_sha ?? null,
          url: c.html_url ?? null,
        },
      };
    }
    case 'deployment_status': {
      const ds = body.deployment_status;
      const d = body.deployment;
      if (!ds) return null;
      const failed = ds.state === 'failure' || ds.state === 'error';
      const succeeded = ds.state === 'success';
      if (!failed && !succeeded) return null;
      return {
        kind: failed ? 'github.deployment.failed' : 'github.deployment.succeeded',
        title:
          `${repo} · deployment to ${ds.environment ?? d?.environment ?? 'unknown'} ${ds.state}`.slice(
            0,
            240,
          ),
        importance: failed ? 0.8 : 0.65,
        payload: {
          provider: 'github',
          event,
          repo,
          environment: ds.environment ?? d?.environment ?? null,
          state: ds.state ?? null,
          ref: d?.ref ?? null,
          url: ds.target_url ?? null,
        },
      };
    }
    case 'star': {
      // Only `created` is interesting; `deleted` is noise.
      if (body.action !== 'created') return null;
      return {
        kind: 'github.star.added',
        title: `${repo} starred by ${sender}`.slice(0, 240),
        importance: 0.45,
        payload: {
          provider: 'github',
          event,
          repo,
          sender,
          starredAt: body.starred_at ?? null,
        },
      };
    }
    case 'fork': {
      return {
        kind: 'github.fork',
        title: `${repo} forked by ${sender}`.slice(0, 240),
        importance: 0.55,
        payload: {
          provider: 'github',
          event,
          repo,
          sender,
          fork: body.forkee?.full_name ?? null,
          url: body.forkee?.html_url ?? null,
        },
      };
    }
    case 'member': {
      return {
        kind: `github.member.${body.action ?? 'updated'}`,
        title:
          `${repo} member ${body.member?.login ?? 'unknown'} ${body.action ?? 'changed'}`.slice(
            0,
            240,
          ),
        importance: 0.5,
        payload: {
          provider: 'github',
          event,
          action: body.action ?? null,
          repo,
          member: body.member?.login ?? null,
        },
      };
    }
    case 'security_advisory': {
      const a = body.security_advisory;
      if (!a) return null;
      // Only `published` / `updated` are interesting; `withdrawn` is housekeeping.
      if (body.action && body.action !== 'published' && body.action !== 'updated') return null;
      const sev = (a.severity ?? '').toLowerCase();
      const importance =
        sev === 'critical' || sev === 'high' ? 0.9 : sev === 'moderate' ? 0.6 : 0.45;
      return {
        kind: 'github.security.advisory',
        title:
          `${repo} · advisory ${a.ghsa_id ?? ''} (${sev || 'unknown'}): ${(a.summary ?? '').slice(0, 120)}`.slice(
            0,
            240,
          ),
        importance,
        payload: {
          provider: 'github',
          event,
          action: body.action ?? null,
          repo,
          ghsaId: a.ghsa_id ?? null,
          cveId: a.cve_id ?? null,
          severity: sev || null,
          summary: a.summary ?? null,
          url: a.references?.[0]?.url ?? null,
        },
      };
    }
    case 'dependabot_alert':
    case 'repository_vulnerability_alert': {
      const al = body.alert;
      if (!al) return null;
      // Surface creation + reopen; skip resolved/dismissed (less urgent).
      if (
        body.action &&
        body.action !== 'created' &&
        body.action !== 'reopened' &&
        body.action !== 'auto_reopened'
      )
        return null;
      const sev = (
        al.severity ??
        al.security_advisory?.severity ??
        al.security_vulnerability?.severity ??
        ''
      ).toLowerCase();
      const importance =
        sev === 'critical' || sev === 'high' ? 0.85 : sev === 'moderate' ? 0.55 : 0.4;
      const pkgName = al.package?.name ?? al.security_vulnerability?.package?.name ?? 'unknown';
      const summary = al.summary ?? al.security_advisory?.summary ?? `${pkgName} vulnerability`;
      return {
        kind: 'github.security.alert',
        title: `${repo} · ${pkgName} ${sev || 'vulnerability'}: ${summary.slice(0, 120)}`.slice(
          0,
          240,
        ),
        importance,
        payload: {
          provider: 'github',
          event,
          action: body.action ?? null,
          repo,
          alertNumber: al.number ?? null,
          severity: sev || null,
          packageName: pkgName,
          ecosystem: al.package?.ecosystem ?? null,
          ghsaId: al.security_advisory?.ghsa_id ?? null,
          url: al.html_url ?? null,
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Look up integration + resource for a repo so we can warm the snapshot.
 * Returns one entry per (workspace, integration, resource) — typically 1.
 */
async function findRepoSyncTargets(repoFullName: string) {
  const db = getDb();
  const rows = await db
    .select({
      workspaceId: integrationResource.workspaceId,
      integrationId: integrationResource.integrationId,
      resourceId: integrationResource.id,
    })
    .from(integrationResource)
    .innerJoin(
      projectLink,
      and(
        eq(projectLink.workspaceId, integrationResource.workspaceId),
        eq(projectLink.resourceId, integrationResource.id),
      ),
    )
    .where(
      and(eq(integrationResource.kind, 'repo'), eq(integrationResource.externalId, repoFullName)),
    );
  // Dedupe by resourceId (multiple projects can link the same repo).
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.resourceId)) return false;
    seen.add(r.resourceId);
    return true;
  });
}

const STATS_REFRESH_EVENTS = new Set([
  'push',
  'pull_request',
  'pull_request_review',
  'issues',
  'release',
  'workflow_run',
  'create',
  'delete',
]);

export async function POST(req: Request) {
  const sig = req.headers.get('x-hub-signature-256');
  const event = req.headers.get('x-github-event') ?? 'unknown';
  const payload = await req.text();
  if (!github.verifyGithubWebhook(payload, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Health-check / handshake events.
  if (event === 'ping') return NextResponse.json({ ok: true, pong: true });

  let body: RepoPayload;
  try {
    body = JSON.parse(payload) as RepoPayload;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const fullName = body.repository?.full_name;
  if (!fullName) return NextResponse.json({ ok: true, routed: 0 });

  const links = await projectsByGithubRepoGlobal(fullName);
  if (links.length === 0) return NextResponse.json({ ok: true, routed: 0 });

  const describedRaw = describe(event, body);
  if (!describedRaw) {
    return NextResponse.json({ ok: true, routed: 0, reason: 'unhandled_event' });
  }
  const describedList = Array.isArray(describedRaw) ? describedRaw : [describedRaw];

  const db = getDb();
  // Cartesian product: one row per (link, described event). Most events
  // produce a single described row, so this collapses to len(links).
  const rows = links.flatMap((l) =>
    describedList.map((d) => ({
      workspaceId: l.workspaceId,
      projectId: l.projectId,
      kind: d.kind,
      title: d.title,
      importance: d.importance,
      payload: d.payload,
      ...(d.occurredAt ? { occurredAt: d.occurredAt } : {}),
    })),
  );
  await db.insert(timelineEvent).values(rows);

  // Fan to the conductor so the supervisor can react. One observe per
  // workspace is enough — multiple projects in the same workspace get
  // collapsed by the tick debounce. We use the first described event as
  // the headline kind (per-commit fan-outs would otherwise spam the bus).
  const headline = describedList[0]!;
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.workspaceId)) continue;
    seen.add(l.workspaceId);
    await inngest.send({
      name: 'conductor/observe',
      data: {
        workspaceId: l.workspaceId,
        eventKind: headline.kind,
        payload: { repo: fullName, projectId: l.projectId, ...headline.payload },
      },
    });
  }

  // Warm the stats snapshot for every linked workspace so the dashboard
  // reflects the new push within seconds.
  if (STATS_REFRESH_EVENTS.has(event)) {
    const targets = await findRepoSyncTargets(fullName);
    for (const t of targets) {
      if (!t.integrationId) continue;
      await inngest.send({
        name: 'github/stats.sync.repo',
        data: {
          workspaceId: t.workspaceId,
          integrationId: t.integrationId,
          resourceId: t.resourceId,
          repoFullName: fullName,
          reason: `webhook:${event}`,
        },
      });
    }
  }

  return NextResponse.json({ ok: true, routed: links.length });
}
