/**
 * Weekly digest email — narrative version.
 *
 * Sibling to `dailyDigestEmailCron`. Where the daily one bullet-points
 * the top 10 timeline events of the last 24h, this one runs Mondays at
 * 07:30 UTC and asks the workspace's BYOK provider to synthesize a
 * short, human-feeling weekly recap from the last 7 days of timeline
 * events, decisions, and momentum changes.
 *
 * Fail-soft strategy:
 *  - If RESEND_API_KEY is missing → skip silently.
 *  - If no BYOK credential is configured → fall back to the same
 *    bullet-list shape as the daily cron so the user still gets *some*
 *    weekly email.
 *  - If the LLM call fails → fall back to bullets.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { generateText } from 'ai';
import { inngest } from '../client';
import { getDb } from '@metu/db';
import {
  agentPolicy,
  decision,
  deviceEvent,
  timelineEvent,
  user,
  workspace,
  workspaceMember,
} from '@metu/db/schema';
import { getModel } from '@metu/ai';
import { log } from '@/lib/logger';

const RESEND_FROM = process.env.RESEND_FROM ?? 'metu <hello@metu.app>';

async function sendEmail(input: { to: string; subject: string; text: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
    });
    return r.ok;
  } catch (err) {
    log.warn('digest.email.send_failed', {
      to: input.to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export const weeklyDigestEmailCron = inngest.createFunction(
  {
    id: 'weekly-digest-email-cron',
    name: 'Weekly digest email',
    concurrency: { limit: 3 },
  },
  // Mondays at 07:30 UTC — half an hour after the daily cron so they
  // don't compete for the LLM provider's per-minute budget.
  { cron: '30 7 * * 1' },
  async ({ step, logger }) => {
    if (!process.env.RESEND_API_KEY) {
      logger.info('weekly-digest-email-cron skipped: RESEND_API_KEY not set');
      return { skipped: true };
    }
    const db = getDb();

    const owners = await step.run('owners', async () => {
      const rows = await db
        .select({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          userId: workspaceMember.userId,
          email: user.email,
        })
        .from(workspace)
        .innerJoin(workspaceMember, eq(workspaceMember.workspaceId, workspace.id))
        .innerJoin(user, eq(user.id, workspaceMember.userId))
        .innerJoin(agentPolicy, eq(agentPolicy.workspaceId, workspace.id))
        .where(and(eq(workspaceMember.role, 'owner'), eq(agentPolicy.enabled, true)));
      return rows;
    });

    let sent = 0;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    for (const o of owners) {
      const [events, decisions] = await Promise.all([
        db
          .select({
            kind: timelineEvent.kind,
            title: timelineEvent.title,
            body: timelineEvent.body,
            importance: timelineEvent.importance,
            occurredAt: timelineEvent.occurredAt,
          })
          .from(timelineEvent)
          .where(
            and(eq(timelineEvent.workspaceId, o.workspaceId), gte(timelineEvent.occurredAt, since)),
          )
          .orderBy(desc(timelineEvent.importance), desc(timelineEvent.occurredAt))
          .limit(40),
        db
          .select({
            title: decision.title,
            rationale: decision.rationale,
            decidedAt: decision.decidedAt,
          })
          .from(decision)
          .where(and(eq(decision.workspaceId, o.workspaceId), gte(decision.decidedAt, since)))
          .orderBy(desc(decision.decidedAt))
          .limit(10),
      ]);

      // Ambient device signals (vscode terminals + git, browser-ext copies +
      // form submits, companion focus, mobile photos). Aggregated by kind so
      // the digest can mention "you opened 14 terminals, copied 27 selections"
      // without leaking content.
      const ambient = await db
        .select({
          kind: deviceEvent.kind,
          n: sql<number>`count(*)::int`,
        })
        .from(deviceEvent)
        .where(and(eq(deviceEvent.workspaceId, o.workspaceId), gte(deviceEvent.occurredAt, since)))
        .groupBy(deviceEvent.kind)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

      if (events.length === 0 && decisions.length === 0) continue;

      const fallback = buildFallback(o.workspaceName, events, decisions);
      const text = await step.run(`synth-${o.workspaceId}`, async () => {
        try {
          const { model } = await getModel({
            workspaceId: o.workspaceId,
            intent: 'fast',
          });
          const prompt = buildPrompt(o.workspaceName, events, decisions, ambient);
          const { text: synth } = await generateText({
            model,
            prompt,
            maxOutputTokens: 600,
          });
          const trimmed = synth?.trim();
          return trimmed && trimmed.length > 80 ? trimmed : fallback;
        } catch (err) {
          log.warn('digest.weekly.synth_failed', { workspaceId: o.workspaceId }, err);
          return fallback;
        }
      });

      const ok = await step.run(`send-${o.workspaceId}`, () =>
        sendEmail({
          to: o.email,
          subject: `metu — your week in ${o.workspaceName}`,
          text,
        }),
      );
      if (ok) {
        sent++;
        await db.insert(timelineEvent).values({
          workspaceId: o.workspaceId,
          userId: o.userId,
          kind: 'digest.email.sent',
          title: 'Weekly digest email sent',
          body: `${events.length} events, ${decisions.length} decisions summarized`,
          payload: { events: events.length, decisions: decisions.length, cadence: 'weekly' },
          importance: 0.25,
        });
      }
    }

    return { sent, candidates: owners.length };
  },
);

type EventRow = {
  kind: string;
  title: string;
  body: string | null;
  importance: number | null;
  occurredAt: Date;
};
type DecisionRow = {
  title: string;
  rationale: string | null;
  decidedAt: Date | null;
};

function buildPrompt(
  workspaceName: string,
  events: EventRow[],
  decisions: DecisionRow[],
  ambient: { kind: string; n: number }[] = [],
): string {
  const eventLines = events
    .map((e) => `- [${e.kind}] ${e.title}${e.body ? ` — ${truncate(e.body, 140)}` : ''}`)
    .join('\n');
  const decisionLines = decisions
    .map((d) => `- ${d.title}${d.rationale ? ` — ${truncate(d.rationale, 160)}` : ''}`)
    .join('\n');
  const ambientLines = ambient.map((a) => `- ${a.kind}: ${a.n}`).join('\n');
  return [
    `You are writing a short, friendly weekly recap for the user of "${workspaceName}".`,
    `Tone: calm, concise, second-person ("you"). 4–7 sentences. No headings, no bullet lists.`,
    `Surface what's *meaningful* — momentum, recurring themes, decisions, blockers. Skip housekeeping events.`,
    `If there's nothing meaningful, say so honestly in one sentence.`,
    `End with a single open-ended question that nudges the user toward their next concrete step.`,
    ``,
    `Timeline (last 7 days, ranked by importance):`,
    eventLines || '(none)',
    ``,
    `Decisions logged (last 7 days):`,
    decisionLines || '(none)',
    ``,
    `Ambient activity counts (last 7 days, raw signals from VS Code, browser, companion, mobile):`,
    ambientLines || '(none)',
    ``,
    `Write the recap as plain text only. Do not include a salutation or sign-off.`,
  ].join('\n');
}

function buildFallback(
  workspaceName: string,
  events: EventRow[],
  decisions: DecisionRow[],
): string {
  const lines: string[] = [`Your week in ${workspaceName}`, ''];
  if (events.length > 0) {
    lines.push('Highlights:');
    for (const e of events.slice(0, 8)) {
      lines.push(`• [${e.kind}] ${e.title}`);
    }
    lines.push('');
  }
  if (decisions.length > 0) {
    lines.push('Decisions:');
    for (const d of decisions) {
      lines.push(`• ${d.title}`);
    }
    lines.push('');
  }
  lines.push(`Open metu → ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metu.ro'}/timeline`);
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}
