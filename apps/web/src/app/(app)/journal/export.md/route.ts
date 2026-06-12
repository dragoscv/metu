/**
 * GET /journal/export.md
 *
 * Streams the user's timeline events as a markdown document, grouped by day.
 * Range governed by ?range=7d|30d|90d (defaults to 30d). Authenticated.
 */
import { auth } from '@metu/auth';
import { and, desc, eq, gte } from 'drizzle-orm';
import { format, isSameDay, startOfDay } from 'date-fns';
import { getDb } from '@metu/db';
import { timelineEvent, project } from '@metu/db/schema';

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const url = new URL(request.url);
  const rangeKey = url.searchParams.get('range') ?? '30d';
  const days = RANGES[rangeKey] ?? 30;
  const since = startOfDay(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
  const workspaceId = session.user.workspaceId;
  const db = getDb();

  const rows = await db
    .select({
      kind: timelineEvent.kind,
      title: timelineEvent.title,
      body: timelineEvent.body,
      importance: timelineEvent.importance,
      projectName: project.name,
      occurredAt: timelineEvent.occurredAt,
    })
    .from(timelineEvent)
    .leftJoin(project, eq(timelineEvent.projectId, project.id))
    .where(and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)))
    .orderBy(desc(timelineEvent.occurredAt))
    .limit(2000);

  const lines: string[] = [];
  lines.push(`# Journal — last ${days} days`);
  lines.push('');
  lines.push(`_Exported ${format(new Date(), "yyyy-MM-dd 'at' HH:mm")} · ${rows.length} events._`);
  lines.push('');

  let prevDay: Date | null = null;
  for (const e of rows) {
    const eventDay = startOfDay(new Date(e.occurredAt));
    if (!prevDay || !isSameDay(prevDay, eventDay)) {
      lines.push('');
      lines.push(`## ${format(eventDay, 'EEEE, MMM d, yyyy')}`);
      lines.push('');
      prevDay = eventDay;
    }
    const t = format(new Date(e.occurredAt), 'HH:mm');
    const proj = e.projectName ? ` _(${e.projectName})_` : '';
    const star = e.importance >= 0.7 ? ' ⭐' : '';
    lines.push(`- **${t}** · \`${e.kind}\`${proj} — ${e.title}${star}`);
    if (e.body) {
      const indented = e.body
        .split(/\r?\n/)
        .map((line) => `  > ${line}`)
        .join('\n');
      lines.push(indented);
    }
  }

  const body = lines.join('\n') + '\n';
  const filename = `metu-journal-${format(new Date(), 'yyyy-MM-dd')}-${rangeKey}.md`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
