import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { streak, streakEntry } from '../schema';

export interface ListStreaksParams {
  workspaceId: string;
  includeArchived?: boolean;
  kind?: 'abstain' | 'do_daily' | 'count' | 'boolean' | null;
}

export async function listStreaks({
  workspaceId,
  includeArchived = false,
  kind = null,
}: ListStreaksParams) {
  const db = getDb();
  const filters = [eq(streak.workspaceId, workspaceId)];
  if (!includeArchived) filters.push(isNull(streak.archivedAt));
  if (kind) filters.push(sql`${streak.kind}::text = ${kind}`);
  return db
    .select()
    .from(streak)
    .where(and(...filters))
    .orderBy(desc(streak.weight), asc(streak.name));
}

export async function getStreakById(workspaceId: string, streakId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(streak)
    .where(and(eq(streak.id, streakId), eq(streak.workspaceId, workspaceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listStreakEntries(workspaceId: string, streakId: string, sinceDays = 90) {
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  return db
    .select()
    .from(streakEntry)
    .where(
      and(
        eq(streakEntry.workspaceId, workspaceId),
        eq(streakEntry.streakId, streakId),
        gte(streakEntry.day, since.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(asc(streakEntry.day));
}

/** Bulk fetch entries for a list of streaks (for cards on /streaks page). */
export async function listEntriesForStreaks(
  workspaceId: string,
  streakIds: string[],
  sinceDays = 90,
) {
  if (streakIds.length === 0) return [];
  const db = getDb();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);
  return db
    .select()
    .from(streakEntry)
    .where(
      and(
        eq(streakEntry.workspaceId, workspaceId),
        gte(streakEntry.day, since.toISOString().slice(0, 10)),
        inArray(streakEntry.streakId, streakIds),
      ),
    )
    .orderBy(asc(streakEntry.day));
}

/** Upsert a single day's entry — re-logging the same day overwrites. */
export async function upsertStreakEntry(opts: {
  workspaceId: string;
  streakId: string;
  day: string; // YYYY-MM-DD
  value?: number;
  failed?: boolean;
  note?: string | null;
}) {
  const db = getDb();
  await db
    .insert(streakEntry)
    .values({
      workspaceId: opts.workspaceId,
      streakId: opts.streakId,
      day: opts.day,
      value: opts.value ?? 1,
      failed: opts.failed ?? false,
      note: opts.note ?? null,
    })
    .onConflictDoUpdate({
      target: [streakEntry.streakId, streakEntry.day],
      set: {
        value: opts.value ?? 1,
        failed: opts.failed ?? false,
        note: opts.note ?? null,
      },
    });
  await db.update(streak).set({ updatedAt: new Date() }).where(eq(streak.id, opts.streakId));
}

export async function deleteStreakEntry(workspaceId: string, streakId: string, day: string) {
  const db = getDb();
  await db
    .delete(streakEntry)
    .where(
      and(
        eq(streakEntry.workspaceId, workspaceId),
        eq(streakEntry.streakId, streakId),
        eq(streakEntry.day, day),
      ),
    );
}

/** Pure: compute current run / longest run / week-count from sorted entries. */
export interface StreakStats {
  currentRun: number;
  longestRun: number;
  thisWeek: number;
  totalValue: number;
  lastEntryDay: string | null;
}

export function computeStreakStats(
  kind: 'abstain' | 'do_daily' | 'count' | 'boolean',
  entries: { day: string; value: number; failed: boolean }[],
  startedAt: Date,
  today = new Date(),
): StreakStats {
  const todayKey = today.toISOString().slice(0, 10);
  const weekAgo = new Date(today);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  const weekAgoKey = weekAgo.toISOString().slice(0, 10);

  const thisWeek = entries.filter((e) => e.day >= weekAgoKey && !e.failed).length;
  const totalValue = entries.reduce((s, e) => (e.failed ? s : s + (e.value || 0)), 0);
  const lastEntryDay = entries.length > 0 ? (entries[entries.length - 1]?.day ?? null) : null;

  if (kind === 'abstain') {
    // Find most recent failure; chain = days since (lastFailure || startedAt).
    const lastFail = [...entries].reverse().find((e) => e.failed);
    const anchor = lastFail ? nextDay(lastFail.day) : startedAt.toISOString().slice(0, 10);
    const currentRun = anchor > todayKey ? 0 : daysBetween(anchor, todayKey) + 1;
    // Longest = longest gap between failures (or start) up to today.
    let longestRun = 0;
    let cursor = startedAt.toISOString().slice(0, 10);
    for (const e of entries) {
      if (e.failed) {
        longestRun = Math.max(longestRun, daysBetween(cursor, e.day));
        cursor = nextDay(e.day);
      }
    }
    longestRun = Math.max(longestRun, daysBetween(cursor, todayKey) + 1);
    return { currentRun, longestRun, thisWeek, totalValue, lastEntryDay };
  }

  // do_daily / boolean / count: consecutive days with a non-failed entry, ending today or yesterday.
  const days = new Set(entries.filter((e) => !e.failed).map((e) => e.day));
  let currentRun = 0;
  const cursor = new Date(today);
  // allow grace: if no entry today, start counting from yesterday
  if (!days.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (days.has(cursor.toISOString().slice(0, 10))) {
    currentRun++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  // Longest run: scan sorted unique days
  const sorted = [...days].sort();
  let longestRun = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev && daysBetween(prev, d) === 1) {
      run++;
    } else {
      run = 1;
    }
    longestRun = Math.max(longestRun, run);
    prev = d;
  }
  return { currentRun, longestRun, thisWeek, totalValue, lastEntryDay };
}

function nextDay(d: string) {
  const dt = new Date(d + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}
