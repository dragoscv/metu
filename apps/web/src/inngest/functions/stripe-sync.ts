/**
 * Stripe sync: every 15 min, pull the most recent events from the Stripe
 * account (capped at 50). Each charge succeeded / payment intent /
 * subscription event → timeline_event(kind=`stripe.${type}`), idempotent
 * on (workspaceId, payload->>'externalId') where externalId = event.id.
 *
 * The token here is a Stripe restricted/secret key the user pasted via
 * the BYOK flow (Stripe doesn't issue OAuth tokens for self-use).
 */
import { inngest } from '../client';
import { parseEvent } from '../schemas';
import { getDb } from '@metu/db';
import { listActiveIntegrationsByKind, markIntegrationSyncSuccess } from '@metu/db/queries';
import { timelineEvent } from '@metu/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getIntegrationToken } from './_integration-token';

const UA = 'metu/0.1.0';

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  livemode?: boolean;
  data?: { object?: Record<string, unknown> };
}

function summarize(ev: StripeEvent): { title: string; importance: number } {
  const t = ev.type ?? 'event';
  const obj = ev.data?.object ?? {};
  if (t.startsWith('charge.') || t.startsWith('payment_intent.')) {
    const amount = typeof obj.amount === 'number' ? obj.amount : 0;
    const currency = typeof obj.currency === 'string' ? obj.currency.toUpperCase() : '';
    return {
      title: `Stripe ${t}: ${(amount / 100).toFixed(2)} ${currency}`.slice(0, 200),
      importance: t.endsWith('.succeeded') ? 0.7 : t.endsWith('.failed') ? 0.8 : 0.5,
    };
  }
  if (t.startsWith('customer.subscription.')) {
    return { title: `Stripe ${t}`, importance: 0.65 };
  }
  if (t.startsWith('invoice.')) {
    return { title: `Stripe ${t}`, importance: 0.55 };
  }
  return { title: `Stripe ${t}`, importance: 0.4 };
}

export const stripeSyncCron = inngest.createFunction(
  { id: 'stripe-sync-cron', name: 'Stripe: fan-out (every 15min)', concurrency: { limit: 1 } },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const rows = await step.run('list', () => listActiveIntegrationsByKind('stripe'));
    for (const r of rows) {
      await step.sendEvent(`stripe-${r.integrationId}`, {
        name: 'stripe/sync.requested',
        data: { workspaceId: r.workspaceId, integrationId: r.integrationId, reason: 'cron' },
      });
    }
    return { queued: rows.length };
  },
);

export const onStripeSync = inngest.createFunction(
  {
    id: 'stripe-sync',
    name: 'Stripe: sync recent events',
    concurrency: { key: 'event.data.workspaceId', limit: 2 },
    retries: 2,
  },
  { event: 'stripe/sync.requested' },
  async ({ event, step }) => {
    const { workspaceId, integrationId } = parseEvent('stripe/sync.requested', event.data);
    const creds = await step.run('token', () =>
      getIntegrationToken(workspaceId, 'stripe', integrationId),
    );
    if (!creds) return { ok: false, reason: 'no-token' };

    const events = await step.run('fetch', async () => {
      const res = await fetch('https://api.stripe.com/v1/events?limit=50', {
        headers: {
          Authorization: `Bearer ${creds.token}`,
          'User-Agent': UA,
          'Stripe-Version': '2024-06-20',
        },
      });
      if (!res.ok) throw new Error(`Stripe ${res.status}`);
      const data = (await res.json()) as { data?: StripeEvent[] };
      return data.data ?? [];
    });

    let upserted = 0;
    for (const ev of events) {
      if (!ev.id || !ev.type) continue;
      const externalId = ev.id;
      const { title, importance } = summarize(ev);
      const occurredAt = new Date((ev.created ?? Math.floor(Date.now() / 1000)) * 1000);
      await step.run(`ev-${externalId}`, async () => {
        const db = getDb();
        await db
          .delete(timelineEvent)
          .where(
            and(
              eq(timelineEvent.workspaceId, workspaceId),
              eq(timelineEvent.kind, `stripe.${ev.type!.split('.')[0]}`),
              sql`${timelineEvent.payload}->>'externalId' = ${externalId}`,
            ),
          );
        await db.insert(timelineEvent).values({
          workspaceId,
          kind: `stripe.${ev.type!.split('.')[0]}`,
          title,
          body: ev.type ?? null,
          payload: {
            externalId,
            integrationId,
            stripeEventId: ev.id,
            stripeType: ev.type,
            livemode: ev.livemode,
            object: ev.data?.object,
          },
          importance,
          occurredAt,
        });
      });
      upserted++;
    }

    await step.run('mark-success', () => markIntegrationSyncSuccess(integrationId));
    return { ok: true, upserted };
  },
);
