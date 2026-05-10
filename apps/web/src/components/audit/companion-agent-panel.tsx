import Link from 'next/link';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { Card, CardTitle } from '@metu/ui';
import { getDb } from '@metu/db';
import { timelineEvent } from '@metu/db/schema';

const COMPANION_KINDS = [
  'conductor.observed.companion-agent escalate',
  'conductor.observed.companion-agent.escalated',
  'conductor.observed.companion-agent.local',
];

interface Props {
  workspaceId: string;
  since: Date;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  payload: unknown;
  occurredAt: Date;
}

function fmt(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const dd = Math.floor(h / 24);
  return `${dd}d ago`;
}

export async function CompanionAgentPanel({ workspaceId, since }: Props) {
  const db = getDb();
  const rows: Row[] = await db
    .select({
      id: timelineEvent.id,
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      body: timelineEvent.body,
      payload: timelineEvent.payload,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .where(
      and(
        eq(timelineEvent.workspaceId, workspaceId),
        gte(timelineEvent.occurredAt, since),
        inArray(timelineEvent.kind, COMPANION_KINDS),
      ),
    )
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(20);

  const escalations = rows.filter((r) => r.kind.includes('escalat'));
  const local = rows.length - escalations.length;

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Companion-agent activity</CardTitle>
        <Link
          href={`/timeline?kind=${encodeURIComponent(COMPANION_KINDS[0]!)}`}
          className="text-xs text-[var(--color-fg-subtle)] underline"
        >
          See all in timeline →
        </Link>
      </div>
      <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
        {escalations.length} escalations · {local} local turns in this window.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-fg-subtle)]">
          No companion-agent observations recorded yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 8).map((r) => {
            const p = (r.payload ?? {}) as {
              surface?: string;
              personaSlug?: string;
              triage?: string;
              eventId?: string;
            };
            const isEscalation = r.kind.includes('escalat');
            const href = p.eventId ? `/timeline?event=${p.eventId}` : `/timeline`;
            return (
              <li
                key={r.id}
                className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      isEscalation
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-400'
                    }`}
                  >
                    {isEscalation ? 'escalate' : 'local'}
                  </span>
                  <Link href={href} className="flex-1 truncate font-medium hover:underline">
                    {r.title}
                  </Link>
                  <span className="text-xs text-[var(--color-fg-subtle)]">{fmt(r.occurredAt)}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--color-fg-subtle)]">
                  {[p.surface, p.personaSlug, p.triage].filter(Boolean).join(' · ') || ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
