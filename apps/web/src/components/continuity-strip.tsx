/**
 * Continuity strip — dashboard widget showing the most recent "where was I?"
 * briefing per project. Cards link to the project page where the full
 * briefing + Regenerate live. If no briefings exist yet, a single CTA card
 * explains how to get one.
 */
import Link from 'next/link';
import { Sparkles, ArrowRight, Clock } from 'lucide-react';
import { Card, CardTitle, Badge } from '@metu/ui';
import { listRecentBriefings, countActiveProjectsWithoutFreshBriefing } from '@metu/db/queries';

interface Props {
  workspaceId: string;
  limit?: number;
}

function relativeTime(d: Date): string {
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
  if (diffSec < 86_400) return `${Math.round(diffSec / 3600)} h ago`;
  return `${Math.round(diffSec / 86_400)} d ago`;
}

function snippet(text: string, max = 220): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

export async function ContinuityStrip({ workspaceId, limit = 3 }: Props) {
  const [briefings, stalePrewarmCount] = await Promise.all([
    listRecentBriefings(workspaceId, limit),
    countActiveProjectsWithoutFreshBriefing(workspaceId),
  ]);

  if (briefings.length === 0) {
    return (
      <Card>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
            Where you left off
          </CardTitle>
          {stalePrewarmCount > 0 ? (
            <Badge variant="neutral">
              {stalePrewarmCount} project{stalePrewarmCount === 1 ? '' : 's'} warming
            </Badge>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-[var(--color-fg-subtle)]">
          metu generates a 4-paragraph context briefing per project — what you were doing, why, what
          blocked you, the smallest next step. Open a project to generate the first one, or wait for
          the morning cron at 6:00 UTC.
        </p>
      </Card>
    );
  }

  return (
    <section className="space-y-3" aria-labelledby="continuity-strip">
      <div className="flex items-end justify-between gap-3">
        <h2
          id="continuity-strip"
          className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg)]"
        >
          <Sparkles className="h-4 w-4 text-[var(--color-brand)]" />
          Where you left off
        </h2>
        {stalePrewarmCount > 0 ? (
          <span className="text-xs text-[var(--color-fg-subtle)]">
            {stalePrewarmCount} more project{stalePrewarmCount === 1 ? '' : 's'} warming…
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {briefings.map((b) => (
          <Link
            key={b.id}
            href={`/projects/${b.projectId}`}
            className="hover:border-[var(--color-brand)]/40 group block rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="line-clamp-1 text-sm font-medium text-[var(--color-fg)]">
                {b.projectName}
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-fg-subtle)] transition group-hover:translate-x-0.5 group-hover:text-[var(--color-brand)]" />
            </div>
            <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-[var(--color-fg-subtle)]">
              {snippet(b.briefing)}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
              <Clock className="h-3 w-3" />
              <span>{relativeTime(b.generatedAt)}</span>
              {b.modelProvider ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">{b.modelProvider}</span>
                </>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
