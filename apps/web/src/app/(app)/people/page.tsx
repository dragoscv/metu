/**
 * /people — entities & contacts your memory has accumulated.
 *
 * First-cut implementation: extract @mentions and capitalized name-like
 * tokens from recent captures + timeline events, count occurrences, and
 * surface the people who keep showing up. Postgres-only — no ML pass yet.
 *
 * Future: feed this through an LLM batch job that resolves aliases
 * ("Dragos", "@dragos", "dragos@metu.so") into a stable entity row.
 */
import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { and, eq, gte, sql, isNull } from 'drizzle-orm';
import { Users, MessageSquare, Calendar } from 'lucide-react';
import { Page, PageHeader, Card, Badge } from '@metu/ui';
import { getDb } from '@metu/db';
import { capture, timelineEvent } from '@metu/db/schema';
import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

interface PersonRow {
  name: string;
  kind: 'mention' | 'name';
  mentions: number;
  lastSeen: Date;
  recentSample: string;
}

const COMMON_WORDS = new Set([
  'I',
  'A',
  'An',
  'The',
  'And',
  'But',
  'Or',
  'For',
  'Of',
  'In',
  'On',
  'At',
  'To',
  'From',
  'With',
  'By',
  'As',
  'So',
  'If',
  'Is',
  'It',
  'Be',
  'Do',
  'You',
  'He',
  'She',
  'We',
  'They',
  'Me',
  'My',
  'Your',
  'His',
  'Her',
  'Their',
  'This',
  'That',
  'These',
  'Those',
  'What',
  'When',
  'Where',
  'Why',
  'How',
  'Who',
  'Today',
  'Tomorrow',
  'Yesterday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'OK',
  'TODO',
  'FIXME',
  'API',
  'URL',
  'HTTP',
  'HTTPS',
  'JSON',
  'SQL',
  'CSS',
  'HTML',
]);

/**
 * Extract candidate person tokens from a body of text.
 *   - `@handle`     → mention (high confidence)
 *   - `First Last`  → capitalized 2-token name (medium confidence)
 */
function extract(text: string): Array<{ token: string; kind: 'mention' | 'name' }> {
  const out: Array<{ token: string; kind: 'mention' | 'name' }> = [];
  if (!text) return out;
  // Mentions: @something (alphanumeric + underscore/dot/hyphen).
  for (const m of text.matchAll(/@([a-zA-Z][\w.-]{1,30})/g)) {
    out.push({ token: '@' + m[1]!, kind: 'mention' });
  }
  // Two-token capitalized names (e.g. "Dragos Vladulescu", "John Smith").
  // Reject when the first token is a common word.
  for (const m of text.matchAll(/\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g)) {
    const first = m[1]!;
    if (COMMON_WORDS.has(first)) continue;
    out.push({ token: `${first} ${m[2]}`, kind: 'name' });
  }
  return out;
}

export default async function PeoplePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const sp = await searchParams;
  const days = Math.max(1, Math.min(365, Number(sp.days ?? 60)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const workspaceId = session.user.workspaceId;
  const db = getDb();

  // Pull recent text-bearing rows. Keep payloads modest.
  const [captures, events] = await Promise.all([
    db
      .select({
        id: capture.id,
        content: capture.content,
        capturedAt: capture.capturedAt,
      })
      .from(capture)
      .where(
        and(
          eq(capture.workspaceId, workspaceId),
          isNull(capture.deletedAt),
          gte(capture.capturedAt, since),
          sql`${capture.content} is not null`,
        ),
      )
      .orderBy(sql`${capture.capturedAt} desc`)
      .limit(800),
    db
      .select({
        id: timelineEvent.id,
        title: timelineEvent.title,
        body: timelineEvent.body,
        occurredAt: timelineEvent.occurredAt,
      })
      .from(timelineEvent)
      .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)))
      .orderBy(sql`${timelineEvent.occurredAt} desc`)
      .limit(800),
  ]);

  // Aggregate by (lowercased) token.
  const peopleMap = new Map<string, PersonRow>();
  function bump(token: string, kind: 'mention' | 'name', at: Date, sample: string) {
    const key = token.toLowerCase();
    const existing = peopleMap.get(key);
    if (existing) {
      existing.mentions += 1;
      if (at > existing.lastSeen) {
        existing.lastSeen = at;
        existing.recentSample = sample;
      }
    } else {
      peopleMap.set(key, {
        name: token,
        kind,
        mentions: 1,
        lastSeen: at,
        recentSample: sample,
      });
    }
  }

  for (const c of captures) {
    if (!c.content) continue;
    const tokens = extract(c.content);
    for (const t of tokens) {
      const snippet = c.content.slice(0, 240);
      bump(t.token, t.kind, new Date(c.capturedAt), snippet);
    }
  }
  for (const e of events) {
    const text = `${e.title}\n${e.body ?? ''}`;
    const tokens = extract(text);
    for (const t of tokens) {
      bump(t.token, t.kind, new Date(e.occurredAt), text.slice(0, 240));
    }
  }

  const people = Array.from(peopleMap.values())
    .filter((p) => p.mentions >= 2) // require at least 2 occurrences to surface
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 60);

  return (
    <Page className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" />
            People in your memory
          </span>
        }
        title="People"
        description={`${people.length} people you've mentioned at least twice in the last ${days} days. Extracted from captures and the timeline.`}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {[30, 60, 180, 365].map((d) => {
          const active = d === days;
          return (
            <Link
              key={d}
              href={`/people?days=${d}`}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'bg-[var(--color-brand)]/10 border-[var(--color-brand)] text-[var(--color-brand)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-overlay)]'
              }`}
            >
              Last {d}d
            </Link>
          );
        })}
      </div>

      {people.length === 0 ? (
        <Card className="text-sm text-[var(--color-fg-muted)]">
          No people detected yet. As you capture conversations, emails, or meeting notes mentioning
          @handles or full names, they appear here.
        </Card>
      ) : (
        <ol className="space-y-1.5">
          {people.map((p) => {
            const initial = p.name.replace(/^@/, '').slice(0, 1).toUpperCase();
            return (
              <li key={p.name}>
                <Card className="flex items-start gap-3">
                  <div className="bg-[var(--color-brand)]/10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium text-[var(--color-brand)]">
                    {initial || '?'}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/people/${encodeURIComponent(p.name)}`}
                        className="font-medium hover:text-[var(--color-brand)]"
                      >
                        {p.name}
                      </Link>
                      <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-subtle)]">
                        <Badge variant={p.kind === 'mention' ? 'success' : 'neutral'}>
                          {p.kind === 'mention' ? '@mention' : 'name'}
                        </Badge>
                        <span className="inline-flex items-center gap-0.5">
                          <MessageSquare className="h-3 w-3" />
                          {p.mentions}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <Calendar className="h-3 w-3" />
                          {formatDistanceToNow(p.lastSeen, { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                      {p.recentSample}
                    </p>
                    <Link
                      href={`/memory?q=${encodeURIComponent(p.name)}`}
                      className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-brand)]"
                    >
                      Recall everything about {p.name} →
                    </Link>
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-6 text-center text-[11px] text-[var(--color-fg-subtle)]">
        Heuristic extraction — names with high false-positive risk are filtered. Future: LLM
        resolver to merge aliases.
      </p>
    </Page>
  );
}
