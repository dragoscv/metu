/**
 * Daily digest email.
 *
 * Cron at 07:00 UTC every day. For every workspace whose owner has an
 * email and the agent policy is enabled, gathers the prior 24h of
 * `timeline_event` rows (top 10 by importance), formats a tiny plain-text
 * digest, and dispatches via Resend HTTP API. No SDK dependency — a
 * direct fetch call keeps the dependency surface small.
 *
 * Skipped silently if `RESEND_API_KEY` is not configured. Each delivery
 * also writes a `digest.email.sent` timeline event for audit.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { inngest } from '../client';
import { getDb } from '@metu/db';
import { agentPolicy, timelineEvent, user, workspace, workspaceMember } from '@metu/db/schema';

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
  } catch {
    return false;
  }
}

export const dailyDigestEmailCron = inngest.createFunction(
  {
    id: 'daily-digest-email-cron',
    name: 'Daily digest email',
    concurrency: { limit: 5 },
  },
  { cron: '0 7 * * *' },
  async ({ step, logger }) => {
    if (!process.env.RESEND_API_KEY) {
      logger.info('daily-digest-email-cron skipped: RESEND_API_KEY not set');
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
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const o of owners) {
      const events = await db
        .select({
          title: timelineEvent.title,
          kind: timelineEvent.kind,
          importance: timelineEvent.importance,
          occurredAt: timelineEvent.occurredAt,
        })
        .from(timelineEvent)
        .where(
          and(eq(timelineEvent.workspaceId, o.workspaceId), gte(timelineEvent.occurredAt, since)),
        )
        .orderBy(desc(timelineEvent.importance), desc(timelineEvent.occurredAt))
        .limit(10);

      if (events.length === 0) continue;

      const lines = events.map(
        (e) =>
          `• [${e.kind}] ${e.title}  (${new Date(e.occurredAt).toISOString().slice(11, 16)} UTC)`,
      );
      const text = [
        `Yesterday in ${o.workspaceName}`,
        '',
        ...lines,
        '',
        `Open metu → ${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metu.ro'}/timeline`,
      ].join('\n');

      const ok = await step.run(`send-${o.workspaceId}`, () =>
        sendEmail({
          to: o.email,
          subject: `metu — ${events.length} updates from yesterday`,
          text,
        }),
      );
      if (ok) {
        sent++;
        await db.insert(timelineEvent).values({
          workspaceId: o.workspaceId,
          userId: o.userId,
          kind: 'digest.email.sent',
          title: 'Daily digest email sent',
          body: `${events.length} updates summarized`,
          payload: { events: events.length },
          importance: 0.2,
        });
      }
    }

    return { sent, candidates: owners.length };
  },
);
