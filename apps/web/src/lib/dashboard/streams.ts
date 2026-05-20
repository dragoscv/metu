/**
 * Dashboard observatory — server-side stream aggregator.
 *
 * Reads in parallel from project, goal, capture, task, integration, device.
 * Output: a normalized StreamItem[] consumed by the heartbeat skin.
 *
 * Workspace scoping: every underlying query already filters by workspaceId.
 * This aggregator is itself workspace-scoped via its only argument.
 */
import 'server-only';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { latestSocialPostsByIntegration } from '@metu/db/queries';
import {
  capture,
  device,
  energyLog,
  goal,
  goalCheckin,
  integration,
  project,
  task,
  timelineEvent,
} from '@metu/db/schema';
import type { DashboardPrefs, StreamCategory, StreamItem, Valence } from './types';
import { isStale } from './valence';

const HOURS = (h: number) => h * 60 * 60 * 1000;
const DAYS = (d: number) => d * 24 * HOURS(1);

/** Tiny @-mention / Cap-Cap extractor; mirrored (intentionally simpler) from /people page. */
const PEOPLE_STOP = new Set([
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
function extractPeople(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(/@([a-zA-Z][\w.-]{1,30})/g)) out.push('@' + m[1]!);
  for (const m of text.matchAll(/\b([A-Z][a-z]{1,20})\s+([A-Z][a-z]{1,20})\b/g)) {
    const first = m[1]!;
    if (PEOPLE_STOP.has(first)) continue;
    out.push(`${first} ${m[2]}`);
  }
  return out;
}

/** Pick the valence for a category honoring user override. */
function pickValence(prefs: DashboardPrefs, category: StreamCategory, fallback: Valence): Valence {
  return prefs.valenceOverrides[category] ?? fallback;
}

/**
 * Aggregate streams for the workspace, filtered by user prefs.
 * Returns at most ~120 items so the canvas stays composable.
 */
export async function aggregateStreams(
  workspaceId: string,
  prefs: DashboardPrefs,
): Promise<StreamItem[]> {
  const enabled = new Set<StreamCategory>(prefs.enabledCategories);
  const db = getDb();

  const want = (c: StreamCategory) => enabled.has(c);

  const wantSocial = want('social_posts');
  const latestSocialP = wantSocial
    ? latestSocialPostsByIntegration(workspaceId)
    : Promise.resolve([] as Awaited<ReturnType<typeof latestSocialPostsByIntegration>>);

  const [
    projectsRows,
    goalRows,
    latestCheckins,
    captureRows,
    taskRows,
    integrationRows,
    deviceRows,
  ] = await Promise.all([
    want('project_activity') || want('project_age')
      ? db
          .select({
            id: project.id,
            name: project.name,
            lastMeaningfulActivityAt: project.lastMeaningfulActivityAt,
            createdAt: project.createdAt,
          })
          .from(project)
          .where(and(eq(project.workspaceId, workspaceId), isNull(project.deletedAt)))
          .orderBy(desc(project.lastMeaningfulActivityAt))
          .limit(40)
      : Promise.resolve(
          [] as Array<{
            id: string;
            name: string;
            lastMeaningfulActivityAt: Date | null;
            createdAt: Date;
          }>,
        ),
    want('goals')
      ? db
          .select({
            id: goal.id,
            title: goal.title,
            updatedAt: goal.updatedAt,
          })
          .from(goal)
          .where(and(eq(goal.workspaceId, workspaceId), isNull(goal.deletedAt)))
          .orderBy(desc(goal.weight), desc(goal.updatedAt))
          .limit(20)
      : Promise.resolve([] as Array<{ id: string; title: string; updatedAt: Date }>),
    want('goals')
      ? db
          .select({
            goalId: goalCheckin.goalId,
            latest: sql<Date>`max(${goalCheckin.occurredAt})`.as('latest'),
          })
          .from(goalCheckin)
          .where(eq(goalCheckin.workspaceId, workspaceId))
          .groupBy(goalCheckin.goalId)
      : Promise.resolve([] as Array<{ goalId: string; latest: Date }>),
    want('captures')
      ? db
          .select({
            id: capture.id,
            source: capture.source,
            capturedAt: capture.capturedAt,
          })
          .from(capture)
          .where(and(eq(capture.workspaceId, workspaceId), isNull(capture.deletedAt)))
          .orderBy(desc(capture.capturedAt))
          .limit(1)
      : Promise.resolve([] as Array<{ id: string; source: string | null; capturedAt: Date }>),
    want('tasks')
      ? db
          .select({
            id: task.id,
            title: task.title,
            createdAt: task.createdAt,
            status: task.status,
          })
          .from(task)
          .where(
            and(eq(task.workspaceId, workspaceId), sql`${task.status} not in ('done','dropped')`),
          )
          .orderBy(desc(task.createdAt))
          .limit(30)
      : Promise.resolve(
          [] as Array<{ id: string; title: string; createdAt: Date; status: string }>,
        ),
    want('integrations') || want('social_posts')
      ? db
          .select({
            id: integration.id,
            kind: integration.kind,
            label: integration.label,
            lastSyncAt: integration.lastSyncAt,
            status: integration.status,
          })
          .from(integration)
          .where(eq(integration.workspaceId, workspaceId))
          .orderBy(desc(integration.lastSyncAt))
          .limit(30)
      : Promise.resolve(
          [] as Array<{
            id: string;
            kind: string;
            label: string;
            lastSyncAt: Date | null;
            status: string;
          }>,
        ),
    want('devices')
      ? db
          .select({
            id: device.id,
            name: device.name,
            kind: device.kind,
            lastSeenAt: device.lastSeenAt,
          })
          .from(device)
          .where(eq(device.workspaceId, workspaceId))
          .orderBy(desc(device.lastSeenAt))
          .limit(10)
      : Promise.resolve(
          [] as Array<{
            id: string;
            name: string;
            kind: string;
            lastSeenAt: Date | null;
          }>,
        ),
  ]);

  const items: StreamItem[] = [];

  // Project activity = pulse (recent touches glow)
  if (want('project_activity')) {
    for (const p of projectsRows) {
      if (!p.lastMeaningfulActivityAt) continue;
      items.push({
        id: `project-pulse:${p.id}`,
        category: 'project_activity',
        valence: pickValence(prefs, 'project_activity', 'pulse'),
        label: p.name,
        anchorAt: p.lastMeaningfulActivityAt.toISOString(),
        href: `/projects/${p.id}`,
      });
    }
  }

  // Project age = drift (idea sitting around — gentle warm reminder).
  // Only surface ones with NO recent activity, to avoid double-counting.
  if (want('project_age')) {
    const recentCutoff = Date.now() - HOURS(24 * 7);
    for (const p of projectsRows) {
      const lastTs = p.lastMeaningfulActivityAt?.getTime() ?? 0;
      if (lastTs > recentCutoff) continue;
      items.push({
        id: `project-drift:${p.id}`,
        category: 'project_age',
        valence: pickValence(prefs, 'project_age', 'drift'),
        label: p.name,
        sublabel: 'idea waiting',
        anchorAt: (p.lastMeaningfulActivityAt ?? p.createdAt).toISOString(),
        href: `/projects/${p.id}`,
      });
    }
  }

  // Goals = streak (last check-in; older check-in = longer streak of consistency)
  if (want('goals')) {
    const latestByGoal = new Map(latestCheckins.map((r) => [r.goalId, r.latest]));
    for (const g of goalRows) {
      const latest = latestByGoal.get(g.id);
      const anchor = latest ?? g.updatedAt;
      items.push({
        id: `goal:${g.id}`,
        category: 'goals',
        valence: pickValence(prefs, 'goals', 'streak'),
        label: g.title,
        sublabel: latest ? 'last check-in' : 'no check-ins',
        anchorAt: anchor.toISOString(),
        href: `/goals/${g.id}`,
      });
    }
  }

  // Latest capture = single pulse anchor
  if (want('captures') && captureRows[0]) {
    const c = captureRows[0];
    items.push({
      id: `capture:latest`,
      category: 'captures',
      valence: pickValence(prefs, 'captures', 'pulse'),
      label: 'Last capture',
      sublabel: c.source ?? 'inbox',
      anchorAt: c.capturedAt.toISOString(),
      href: `/inbox`,
    });
  }

  // Tasks = drift (open tasks getting older — warm gentle reminder)
  if (want('tasks')) {
    for (const t of taskRows) {
      items.push({
        id: `task:${t.id}`,
        category: 'tasks',
        valence: pickValence(prefs, 'tasks', 'drift'),
        label: t.title,
        sublabel: t.status,
        anchorAt: t.createdAt.toISOString(),
      });
    }
  }

  // Integrations = pulse (last sync). Social-platform integrations
  // (tiktok/instagram/twitter/...) double as social_posts placeholders
  // until we extract real "last post" timestamps in a later batch.
  if (want('integrations')) {
    for (const i of integrationRows) {
      if (!i.lastSyncAt) continue;
      items.push({
        id: `integration:${i.id}`,
        category: 'integrations',
        valence: pickValence(prefs, 'integrations', 'pulse'),
        label: i.label,
        sublabel: i.kind,
        anchorAt: i.lastSyncAt.toISOString(),
        href: `/integrations`,
      });
    }
  }
  if (want('social_posts')) {
    const socialKinds = new Set(['tiktok', 'instagram', 'twitter', 'youtube', 'reddit']);
    const latestSocial = await latestSocialP;
    const byIntegration = new Map(latestSocial.map((s) => [s.integrationId, s]));
    for (const i of integrationRows) {
      if (!socialKinds.has(i.kind)) continue;
      const latest = byIntegration.get(i.id);
      if (latest) {
        const ageH = (Date.now() - latest.publishedAt.getTime()) / 3_600_000;
        const summary = (latest.title ?? '').slice(0, 60);
        items.push({
          id: `social:${i.id}`,
          category: 'social_posts',
          valence: pickValence(
            prefs,
            'social_posts',
            ageH < 24 ? 'pulse' : ageH < 24 * 14 ? 'streak' : 'drift',
          ),
          label: i.label,
          sublabel: summary ? `${i.kind} · “${summary}”` : `${i.kind} · last post`,
          anchorAt: latest.publishedAt.toISOString(),
          href: latest.url ?? `/integrations`,
        });
      } else if (i.lastSyncAt) {
        // No posts seen yet but the integration has been synced — surface as drift
        items.push({
          id: `social:${i.id}`,
          category: 'social_posts',
          valence: pickValence(prefs, 'social_posts', 'drift'),
          label: i.label,
          sublabel: `${i.kind} · no posts found`,
          anchorAt: i.lastSyncAt.toISOString(),
          href: `/integrations`,
        });
      }
    }
  }

  // Devices = pulse (most-recent online beat)
  if (want('devices')) {
    for (const d of deviceRows) {
      if (!d.lastSeenAt) continue;
      items.push({
        id: `device:${d.id}`,
        category: 'devices',
        valence: pickValence(prefs, 'devices', 'pulse'),
        label: d.name,
        sublabel: d.kind,
        anchorAt: d.lastSeenAt.toISOString(),
        href: `/devices`,
      });
    }
  }

  // ── People ── extracted from recent text-bearing captures + timeline events.
  if (want('people')) {
    const since = new Date(Date.now() - DAYS(30));
    const [pCaptures, pEvents] = await Promise.all([
      db
        .select({ content: capture.content, capturedAt: capture.capturedAt })
        .from(capture)
        .where(
          and(
            eq(capture.workspaceId, workspaceId),
            isNull(capture.deletedAt),
            gte(capture.capturedAt, since),
            sql`${capture.content} is not null`,
          ),
        )
        .orderBy(desc(capture.capturedAt))
        .limit(300),
      db
        .select({
          title: timelineEvent.title,
          body: timelineEvent.body,
          occurredAt: timelineEvent.occurredAt,
        })
        .from(timelineEvent)
        .where(
          and(eq(timelineEvent.workspaceId, workspaceId), gte(timelineEvent.occurredAt, since)),
        )
        .orderBy(desc(timelineEvent.occurredAt))
        .limit(300),
    ]);
    const peopleMap = new Map<string, { name: string; mentions: number; lastSeen: Date }>();
    function bumpPerson(token: string, at: Date) {
      const key = token.toLowerCase();
      const ex = peopleMap.get(key);
      if (ex) {
        ex.mentions += 1;
        if (at > ex.lastSeen) ex.lastSeen = at;
      } else {
        peopleMap.set(key, { name: token, mentions: 1, lastSeen: at });
      }
    }
    for (const c of pCaptures)
      for (const tok of extractPeople(c.content)) bumpPerson(tok, c.capturedAt);
    for (const e of pEvents) {
      const text = `${e.title ?? ''} ${e.body ?? ''}`;
      for (const tok of extractPeople(text)) bumpPerson(tok, e.occurredAt);
    }
    const top = Array.from(peopleMap.values())
      .filter((p) => p.mentions >= 2)
      .sort((a, b) => b.mentions - a.mentions)
      .slice(0, 10);
    for (const p of top) {
      const ageH = (Date.now() - p.lastSeen.getTime()) / 3_600_000;
      items.push({
        id: `person:${p.name.toLowerCase()}`,
        category: 'people',
        valence: pickValence(
          prefs,
          'people',
          ageH < 48 ? 'pulse' : ageH < 24 * 14 ? 'streak' : 'drift',
        ),
        label: p.name,
        sublabel: `${p.mentions} mention${p.mentions === 1 ? '' : 's'}`,
        anchorAt: p.lastSeen.toISOString(),
        href: `/people/${encodeURIComponent(p.name)}`,
      });
    }
  }

  // ── Decisions ── timeline_event rows tagged decision.*
  if (want('decisions')) {
    const since = new Date(Date.now() - DAYS(90));
    const decisionRows = await db
      .select({
        id: timelineEvent.id,
        title: timelineEvent.title,
        occurredAt: timelineEvent.occurredAt,
        projectId: timelineEvent.projectId,
      })
      .from(timelineEvent)
      .where(
        and(
          eq(timelineEvent.workspaceId, workspaceId),
          gte(timelineEvent.occurredAt, since),
          inArray(timelineEvent.kind, ['decision.logged', 'decision.revised', 'decision.revoked']),
        ),
      )
      .orderBy(desc(timelineEvent.occurredAt))
      .limit(20);
    for (const d of decisionRows) {
      const ageH = (Date.now() - d.occurredAt.getTime()) / 3_600_000;
      items.push({
        id: `decision:${d.id}`,
        category: 'decisions',
        valence: pickValence(
          prefs,
          'decisions',
          ageH < 24 ? 'pulse' : ageH < 24 * 30 ? 'streak' : 'drift',
        ),
        label: d.title,
        sublabel: 'decision logged',
        anchorAt: d.occurredAt.toISOString(),
        href: d.projectId ? `/projects/${d.projectId}` : `/timeline`,
      });
    }
  }

  // ── Health ── latest energy log per user (workspace-wide latest of latest)
  if (want('health')) {
    const energyRows = await db
      .select({
        id: energyLog.id,
        energy: energyLog.energy,
        mood: energyLog.mood,
        sleepHours: energyLog.sleepHours,
        loggedAt: energyLog.loggedAt,
      })
      .from(energyLog)
      .where(eq(energyLog.workspaceId, workspaceId))
      .orderBy(desc(energyLog.loggedAt))
      .limit(1);
    if (energyRows[0]) {
      const e = energyRows[0];
      const ageH = (Date.now() - e.loggedAt.getTime()) / 3_600_000;
      const bits: string[] = [`energy ${e.energy}/5`];
      if (e.mood != null) bits.push(`mood ${e.mood}/5`);
      if (e.sleepHours) bits.push(`${e.sleepHours}h slept`);
      items.push({
        id: `health:${e.id}`,
        category: 'health',
        valence: pickValence(
          prefs,
          'health',
          ageH < 24 ? 'pulse' : ageH < 24 * 7 ? 'streak' : 'drift',
        ),
        label: 'Energy log',
        sublabel: bits.join(' · '),
        anchorAt: e.loggedAt.toISOString(),
        href: '/health',
      });
    }
  }

  // Drop stale items per user pref.
  const filtered = items.filter((it) => !isStale(it, prefs.staleAfterDays));
  // Cap to keep canvas composable.
  return filtered.slice(0, 120);
}
