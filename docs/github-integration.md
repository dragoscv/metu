# GitHub integration

How metu observes GitHub activity, what events it ingests, where they
land, and how to extend the surface.

## Two ingestion paths

### 1. Polling — `github-stats-sync`

A cron (`every 2h`) fans out one `github/stats.sync.repo` event per
linked repo. The handler:

- Fetches a snapshot via the REST API (`/repos`, `/branches`,
  `/contributors`, `/search/commits`).
- Walks all branches (up to 300, paginated) so feature-branch activity
  is captured — not just the default branch.
- Computes 30-day momentum signals: `commitsAllLast7d`,
  `commitsAllLast30d`, `branchesActiveLast30d`, `contributorsLast30d`,
  `branchesTotal` plus the legacy default-branch counters.
- Upserts into `github_repo_stats` and updates
  `integration_resource.last_synced_at`.
- Diffs against the previous snapshot to emit timeline rows for unseen
  commits / merged PRs / closed issues. SHAs are dedup'd against the
  last 7 days of `commit.pushed` rows so the webhook path does not
  produce duplicates.

### 2. Real-time — `/api/webhooks/github`

When a repo is linked via `addProjectLinkAction`, an Inngest event
`github/repo.webhook.ensure` is fired. The handler installs (or
updates) a webhook on `POST /repos/:full/hooks` pointing at
`${NEXT_PUBLIC_APP_URL}/api/webhooks/github` with the broadest event
set we can usefully consume. Existing hooks are updated in place.

The webhook payload is:

1. HMAC-verified against `GITHUB_WEBHOOK_SECRET`.
2. Logged into `webhook_event` (full payload, for replay).
3. Routed via `describe()` into a single normalized `RoutedEvent`.
4. Inserted into `timeline_event` for every workspace × project that
   links the repo.
5. For events in `STATS_REFRESH_EVENTS` (push, pr.merged, …), an
   `github/stats.sync.repo` is fired so the snapshot warms within
   seconds rather than waiting for the next 2h cron.

## Event taxonomy

| GitHub event                                          | Timeline kind                                    | Importance     | Notes                                                            |
| ----------------------------------------------------- | ------------------------------------------------ | -------------- | ---------------------------------------------------------------- |
| `push` (default branch)                               | `github.push`                                    | 0.55           | `isDefaultBranch=true`, branch in payload, commitList ≤ 20.      |
| `push` (feature branch)                               | `github.push`                                    | 0.45           | `[branch]` tag in title; carries `branch` in payload.            |
| `push` (refs/tags/\*)                                 | `github.tag.pushed`                              | 0.6            | Split into separate kind so we don't pollute commit-velocity.    |
| `create` (branch / tag)                               | `github.branch.created` / `github.tag.created`   | 0.4 / 0.6      |                                                                  |
| `delete` (branch / tag)                               | `github.branch.deleted` / `github.tag.deleted`   | 0.35           |                                                                  |
| `pull_request` (opened)                               | `github.pr.opened`                               | 0.65           |                                                                  |
| `pull_request` (closed, merged)                       | `github.pr.merged`                               | 0.75           | `headBranch / baseBranch / additions / deletions / changedFiles` |
| `pull_request_review` (approved)                      | `github.pr.review.approved`                      | 0.7            |                                                                  |
| `pull_request_review_comment`                         | `github.pr.review_comment`                       | 0.4            |                                                                  |
| `commit_comment`                                      | `github.commit.commented`                        | 0.4            |                                                                  |
| `issues` (opened / closed)                            | `github.issue.opened` / `github.issue.closed`    | 0.65 / 0.55    |                                                                  |
| `issue_comment` (on PR/issue)                         | `github.pr.commented` / `github.issue.commented` | 0.4            |                                                                  |
| `discussion` / `discussion_comment`                   | `github.discussion.*`                            | 0.4–0.45       |                                                                  |
| `release` (published)                                 | `github.release.published`                       | 0.85           |                                                                  |
| `workflow_run` (completed)                            | `github.workflow.{succeeded,failed}`             | 0.3 / 0.55–0.8 | `durationSec` carried in payload for "minutes used" stats.       |
| `check_run` (failed only)                             | `github.check.failed`                            | 0.55           | Successful checks suppressed (workflow_run already covers).      |
| `deployment_status`                                   | `github.deployment.{succeeded,failed}`           | 0.65 / 0.8     |                                                                  |
| `star` (created)                                      | `github.star.added`                              | 0.45           |                                                                  |
| `fork`                                                | `github.fork`                                    | 0.55           |                                                                  |
| `member` (\*)                                         | `github.member.*`                                | 0.5            |                                                                  |
| `security_advisory`                                   | `github.security.advisory`                       | 0.45–0.9       | Severity-weighted.                                               |
| `dependabot_alert` / `repository_vulnerability_alert` | `github.security.alert`                          | 0.4–0.85       | Only emit on creation / reopen.                                  |

## Momentum scoring

`recomputeMomentum()` (in `@metu/core/project`) maps every row in the
last 30 days to a weight, decays by `2^(-ageDays/7)`, and squashes to
[0, 1]. Velocity-dropped events get a negative weight; `Math.max(0, …)`
keeps the divisor sane.

## Anomaly detection

`projectAnomalyScanCron` (06:00 UTC daily) compares meaningful event
volume in the last 7 days against the prior 7 days. When it dropped by
≥ 40% AND the prior window had ≥ 5 events, a
`project.velocity_dropped` row is inserted (deduplicated within 6
days). The Conductor consumes this as an interrupt.

## Daily digest

`githubDigestDailyCron` (08:00 UTC) summarizes the prior 24h of GitHub
activity per workspace into a single `github.digest.daily` row. The
continuity briefing reads it for "what happened while I was off".

## Adding a new event

1. Map the GitHub payload shape into `RepoPayload` (in
   `apps/web/src/app/api/webhooks/github/route.ts`).
2. Add a `case` arm to `describe()` returning a `RoutedEvent` (or
   `null` to suppress).
3. Add the event to `desiredEvents` in `ensureRepoWebhook()`
   (`packages/integrations/src/github/index.ts`).
4. If the event should warm the snapshot, add its name to
   `STATS_REFRESH_EVENTS` in the route.
5. If you introduced a new `kind`, add a weight to
   `recomputeMomentum()` in `packages/core/src/project/index.ts`.

## Related code paths

- `apps/web/src/app/api/webhooks/github/route.ts` — webhook ingest
- `apps/web/src/inngest/functions/github-stats-sync.ts` — polling sync
- `apps/web/src/inngest/functions/github-webhook-ensure.ts` — webhook installer
- `apps/web/src/inngest/functions/github-digest-daily.ts` — daily digest
- `apps/web/src/inngest/functions/project-anomaly-scan.ts` — velocity drop detection
- `packages/integrations/src/github/index.ts` — Octokit + `ensureRepoWebhook`
- `packages/integrations/src/github/stats.ts` — REST snapshot fetcher
- `packages/db/src/schema/external.ts` — `github_repo_stats` + new social/ads tables
- `apps/web/src/components/projects/github-activity-panel.tsx` — UI surface
