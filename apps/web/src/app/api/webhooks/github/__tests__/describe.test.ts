/**
 * Webhook router unit tests — covers the event taxonomy that lands in
 * `timeline_event`. Focuses purely on `describe()` mapping which is
 * the source of truth for which kinds we emit.
 */
import { describe as describeTest, expect, it } from 'vitest';
import { describe, type RepoPayload } from '../route';

const repo = { full_name: 'me/proj', default_branch: 'main' };

function payload(extra: Partial<RepoPayload>): RepoPayload {
  return { repository: repo, sender: { login: 'alice' }, ...extra } as RepoPayload;
}

/** Narrow describe() result to the single-event shape (most tests). */
function one(r: ReturnType<typeof describe>): {
  kind: string;
  title: string;
  importance: number;
  payload: Record<string, unknown>;
} {
  if (!r || Array.isArray(r)) throw new Error('expected single event');
  return r;
}

describeTest('github webhook describe()', () => {
  it('emits per-commit commit.pushed rows for small default-branch push', () => {
    const r = describe(
      'push',
      payload({
        ref: 'refs/heads/main',
        head_commit: { id: 'abc', message: 'fix: x', url: 'u' },
        commits: [
          { id: 'abc', message: 'fix: x', url: 'u' },
          { id: 'def', message: 'feat: y\n\nbody', url: 'u2' },
        ],
      }),
    );
    expect(Array.isArray(r)).toBe(true);
    const arr = r as Array<{ kind: string; payload: { sha?: string; isDefaultBranch?: boolean } }>;
    expect(arr).toHaveLength(2);
    expect(arr[0]!.kind).toBe('commit.pushed');
    expect(arr[0]!.payload.sha).toBe('abc');
    expect(arr[1]!.payload.sha).toBe('def');
    expect(arr[0]!.payload.isDefaultBranch).toBe(true);
  });

  it('collapses large pushes to a single github.push summary', () => {
    const commits = Array.from({ length: 25 }, (_, i) => ({
      id: `sha${i}`,
      message: `m${i}`,
      url: `u${i}`,
    }));
    const r = describe('push', payload({ ref: 'refs/heads/main', commits, distinct_size: 25 }));
    expect(Array.isArray(r)).toBe(false);
    expect((r as { kind: string }).kind).toBe('github.push');
  });

  it('collapses force-pushes to a single github.push summary', () => {
    const r = describe(
      'push',
      payload({
        ref: 'refs/heads/main',
        forced: true,
        commits: [{ id: 'abc', message: 'm', url: 'u' }],
      }),
    );
    expect(Array.isArray(r)).toBe(false);
    const summary = r as { kind: string; payload: { forced?: boolean } };
    expect(summary.kind).toBe('github.push');
    expect(summary.payload.forced).toBe(true);
  });

  it('emits github.push tagged with branch for feature push', () => {
    const r = describe(
      'push',
      payload({
        ref: 'refs/heads/feature/x',
        commits: [{ id: 'abc', message: 'wip', url: 'u' }],
      }),
    );
    // Single feature-branch commit → also fans out per-commit
    const arr = r as Array<{
      kind: string;
      payload: { branch?: string; isDefaultBranch?: boolean };
    }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]!.kind).toBe('commit.pushed');
    expect(arr[0]!.payload.branch).toBe('feature/x');
    expect(arr[0]!.payload.isDefaultBranch).toBe(false);
  });

  it('emits github.tag.pushed for tag refs', () => {
    const r = one(describe('push', payload({ ref: 'refs/tags/v1.0.0' })));
    expect(r.kind).toBe('github.tag.pushed');
    expect(r.payload.tag).toBe('v1.0.0');
  });

  it('emits github.pr.merged when PR is closed merged', () => {
    const r = one(
      describe(
        'pull_request',
        payload({
          action: 'closed',
          pull_request: {
            number: 7,
            title: 'add feature',
            html_url: 'u',
            merged: true,
            base: { ref: 'main' },
            head: { ref: 'feat' },
            additions: 50,
            deletions: 10,
            changed_files: 3,
          },
        }),
      ),
    );
    expect(r.kind).toBe('github.pr.merged');
    expect(r.payload.headBranch).toBe('feat');
    expect(r.payload.additions).toBe(50);
  });

  it('emits github.pr.opened on PR open', () => {
    const r = one(
      describe(
        'pull_request',
        payload({
          action: 'opened',
          pull_request: { number: 8, title: 't', html_url: 'u', base: { ref: 'main' } },
        }),
      ),
    );
    expect(r.kind).toBe('github.pr.opened');
  });

  it('emits github.pr.review.approved on review approval', () => {
    const r = one(
      describe(
        'pull_request_review',
        payload({
          action: 'submitted',
          review: { state: 'approved', html_url: 'u', user: { login: 'bob' } },
          pull_request: { number: 9, title: 't', html_url: 'u' },
        }),
      ),
    );
    expect(r.kind).toBe('github.pr.review.approved');
    expect(r.importance).toBeGreaterThanOrEqual(0.6);
  });

  it('emits github.issue.closed on issue close', () => {
    const r = one(
      describe(
        'issues',
        payload({
          action: 'closed',
          issue: { number: 1, title: 'bug', html_url: 'u' },
        }),
      ),
    );
    expect(r.kind).toBe('github.issue.closed');
  });

  it('emits github.release.published on release', () => {
    const r = one(
      describe(
        'release',
        payload({
          action: 'published',
          release: { name: 'v1', tag_name: 'v1.0.0', html_url: 'u' },
        }),
      ),
    );
    expect(r.kind).toBe('github.release.published');
    expect(r.importance).toBeGreaterThanOrEqual(0.8);
  });

  it('emits github.workflow.failed for default-branch CI failure with duration', () => {
    const r = one(
      describe(
        'workflow_run',
        payload({
          action: 'completed',
          workflow_run: {
            name: 'CI',
            status: 'completed',
            conclusion: 'failure',
            head_branch: 'main',
            run_number: 42,
            html_url: 'u',
            run_started_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:05:00Z',
          },
        }),
      ),
    );
    expect(r.kind).toBe('github.workflow.failed');
    expect(r.importance).toBeGreaterThanOrEqual(0.7);
    expect(r.payload.durationSec).toBe(300);
  });

  it('suppresses successful check_run (workflow_run already covers)', () => {
    const r = describe(
      'check_run',
      payload({
        check_run: { name: 'lint', status: 'completed', conclusion: 'success', html_url: 'u' },
      }),
    );
    expect(r).toBeNull();
  });

  it('emits github.security.alert for new dependabot alert', () => {
    const r = one(
      describe(
        'dependabot_alert',
        payload({
          action: 'created',
          alert: {
            number: 1,
            state: 'open',
            severity: 'critical',
            summary: 'RCE in foo',
            package: { name: 'foo', ecosystem: 'npm' },
            html_url: 'u',
          },
        }),
      ),
    );
    expect(r.kind).toBe('github.security.alert');
    expect(r.importance).toBeGreaterThanOrEqual(0.7);
    expect(r.payload.packageName).toBe('foo');
  });

  it('emits github.security.advisory on advisory publish', () => {
    const r = one(
      describe(
        'security_advisory',
        payload({
          action: 'published',
          security_advisory: {
            ghsa_id: 'GHSA-x',
            summary: 'critical thing',
            severity: 'critical',
            cve_id: 'CVE-1',
            references: [{ url: 'u' }],
          },
        }),
      ),
    );
    expect(r.kind).toBe('github.security.advisory');
    expect(r.payload.severity).toBe('critical');
  });

  it('emits github.fork on fork', () => {
    const r = one(describe('fork', payload({ forkee: { full_name: 'them/proj', html_url: 'u' } })));
    expect(r.kind).toBe('github.fork');
  });

  it('returns null for unknown / unhandled events', () => {
    expect(describe('thing_we_dont_handle', payload({}))).toBeNull();
  });
});
