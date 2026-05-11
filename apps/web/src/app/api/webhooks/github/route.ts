import { NextResponse } from 'next/server';
import { github } from '@metu/integrations';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';
import { projectsByGithubRepoGlobal } from '@metu/db/queries';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

interface RepoPayload {
  repository?: { full_name?: string };
  action?: string;
  sender?: { login?: string };
  head_commit?: { message?: string; url?: string };
  pull_request?: {
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
  };
  issue?: {
    title?: string;
    number?: number;
    html_url?: string;
    user?: { login?: string };
  };
  commits?: { message?: string; url?: string }[];
}

interface RoutedEvent {
  kind: string;
  title: string;
  importance: number;
  metadata: Record<string, unknown>;
}

function describe(event: string, body: RepoPayload): RoutedEvent | null {
  switch (event) {
    case 'push': {
      const commits = body.commits ?? [];
      const sender = body.sender?.login ?? 'unknown';
      const first = body.head_commit?.message ?? commits[0]?.message ?? '';
      return {
        kind: 'github.push',
        title:
          `${sender} pushed ${commits.length} commit${commits.length === 1 ? '' : 's'}: ${first.split('\n')[0]}`.slice(
            0,
            240,
          ),
        importance: 0.5,
        metadata: {
          provider: 'github',
          event,
          repo: body.repository?.full_name,
          commits: commits.length,
          sender,
          url: body.head_commit?.url ?? null,
        },
      };
    }
    case 'pull_request': {
      const pr = body.pull_request;
      if (!pr) return null;
      return {
        kind: `github.pr.${body.action ?? 'updated'}`,
        title: `PR #${pr.number} ${body.action}: ${pr.title ?? ''}`.slice(0, 240),
        importance: body.action === 'opened' || body.action === 'closed' ? 0.7 : 0.5,
        metadata: {
          provider: 'github',
          event,
          action: body.action,
          repo: body.repository?.full_name,
          number: pr.number,
          url: pr.html_url,
          sender: pr.user?.login,
        },
      };
    }
    case 'issues': {
      const issue = body.issue;
      if (!issue) return null;
      return {
        kind: `github.issue.${body.action ?? 'updated'}`,
        title: `Issue #${issue.number} ${body.action}: ${issue.title ?? ''}`.slice(0, 240),
        importance: body.action === 'opened' ? 0.6 : 0.4,
        metadata: {
          provider: 'github',
          event,
          action: body.action,
          repo: body.repository?.full_name,
          number: issue.number,
          url: issue.html_url,
          sender: issue.user?.login,
        },
      };
    }
    case 'release': {
      return {
        kind: `github.release.${body.action ?? 'updated'}`,
        title: `Release ${body.action}`,
        importance: 0.8,
        metadata: {
          provider: 'github',
          event,
          action: body.action,
          repo: body.repository?.full_name,
        },
      };
    }
    default:
      return null;
  }
}

export async function POST(req: Request) {
  const sig = req.headers.get('x-hub-signature-256');
  const event = req.headers.get('x-github-event') ?? 'unknown';
  const payload = await req.text();
  if (!github.verifyGithubWebhook(payload, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

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

  const described = describe(event, body);
  if (!described) {
    return NextResponse.json({ ok: true, routed: 0, reason: 'unhandled_event' });
  }

  const db = getDb();
  await db.insert(timelineEvent).values(
    links.map((l) => ({
      workspaceId: l.workspaceId,
      projectId: l.projectId,
      kind: described.kind,
      title: described.title,
      importance: described.importance,
      metadata: described.metadata,
    })),
  );

  // Fan to the conductor so the supervisor can react. One observe per
  // workspace is enough — multiple projects in the same workspace get
  // collapsed by the tick debounce.
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l.workspaceId)) continue;
    seen.add(l.workspaceId);
    await inngest.send({
      name: 'conductor/observe',
      data: {
        workspaceId: l.workspaceId,
        eventKind: described.kind,
        payload: { repo: fullName, projectId: l.projectId, ...described.metadata },
      },
    });
  }

  return NextResponse.json({ ok: true, routed: links.length });
}
