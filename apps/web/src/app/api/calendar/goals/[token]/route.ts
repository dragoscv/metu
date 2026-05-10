/**
 * Public iCalendar feed for goal deadlines (6G).
 *
 * Authentication: opaque token in the URL path (workspace.preferences.calendarFeedToken).
 * Rotating the token in /settings/data invalidates any calendar app
 * subscribed to the prior URL. The route is excluded from proxy.ts
 * cookie-auth so it works in iCloud/Google Calendar without a session.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { goal, workspace } from '@metu/db/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** RFC 5545 date-time in UTC: 20251115T143000Z */
function icsDateTime(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

/** ICS text escape per RFC 5545 §3.3.11. */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Fold a content line at 75 octets, joining with CRLF + single space. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
    i += 73;
  }
  return out.join('\r\n');
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 128) {
    return new NextResponse('not found', { status: 404 });
  }

  const db = getDb();
  // Look up the workspace by token stored in preferences jsonb. Token
  // is opaque random base64url; equality compare is safe.
  const [ws] = await db
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(sql`${workspace.preferences}->>'calendarFeedToken' = ${token}`)
    .limit(1);
  if (!ws) {
    return new NextResponse('not found', { status: 404 });
  }

  const goals = await db
    .select({
      id: goal.id,
      title: goal.title,
      body: goal.body,
      status: goal.status,
      dueAt: goal.dueAt,
      updatedAt: goal.updatedAt,
    })
    .from(goal)
    .where(and(eq(goal.workspaceId, ws.id), isNull(goal.deletedAt), isNotNull(goal.dueAt)))
    .limit(500);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//metu//goals//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${icsText(`metu goals — ${ws.name}`)}`),
    foldLine(`NAME:${icsText(`metu goals — ${ws.name}`)}`),
    'X-PUBLISHED-TTL:PT1H',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];

  const now = new Date();
  for (const g of goals) {
    if (!g.dueAt) continue;
    const due = new Date(g.dueAt);
    // Treat the goal deadline as an all-day-ish point event for 30 min.
    // Most calendars render this as a single dot on the day at the time.
    const end = new Date(due.getTime() + 30 * 60_000);
    const status =
      g.status === 'achieved' ? 'COMPLETED' : g.status === 'dropped' ? 'CANCELLED' : 'CONFIRMED';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:goal-${g.id}@metu`);
    lines.push(`DTSTAMP:${icsDateTime(new Date(g.updatedAt ?? now))}`);
    lines.push(`DTSTART:${icsDateTime(due)}`);
    lines.push(`DTEND:${icsDateTime(end)}`);
    lines.push(foldLine(`SUMMARY:${icsText(g.title)}`));
    if (g.body) lines.push(foldLine(`DESCRIPTION:${icsText(g.body)}`));
    lines.push(`STATUS:${status}`);
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  const body = lines.join('\r\n') + '\r\n';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=300',
      'content-disposition': 'inline; filename="metu-goals.ics"',
    },
  });
}
