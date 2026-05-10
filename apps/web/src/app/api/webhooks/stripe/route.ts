import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { and, eq, sql } from 'drizzle-orm';
import { stripe } from '@metu/integrations';
import { getDb } from '@metu/db';
import {
  stripeWebhookEvent,
  timelineEvent,
  workspaceMember,
  workspaceSubscription,
} from '@metu/db/schema';
import { buildSubscriptionUpsertValues, extractWorkspaceId } from '@/lib/stripe-billing';
import { inngest } from '@/inngest/client';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';

type TimelineKind = 'subscription.activated' | 'subscription.updated' | 'subscription.canceled';

async function writeBillingTimelineEvent(
  workspaceId: string,
  kind: TimelineKind,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(timelineEvent).values({
    workspaceId,
    kind,
    title,
    body,
    payload,
    importance: kind === 'subscription.canceled' ? 0.6 : 0.4,
  });
}

async function upsertFromSubscription(sub: Stripe.Subscription, isCreate: boolean): Promise<void> {
  const values = buildSubscriptionUpsertValues(sub);
  if (!values) {
    log.warn('stripe.webhook.missing_workspace_metadata', { subscriptionId: sub.id });
    return;
  }
  const db = getDb();
  // Capture previous tier so we can fire `conductor/notify` on actual
  // tier changes (not no-op renewals).
  const [prev] = await db
    .select({ tier: workspaceSubscription.tier })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, values.workspaceId))
    .limit(1);
  const prevTier = prev?.tier ?? 'free';
  await db
    .insert(workspaceSubscription)
    .values(values)
    .onConflictDoUpdate({
      target: workspaceSubscription.workspaceId,
      set: {
        tier: values.tier,
        status: values.status,
        stripeCustomerId: values.stripeCustomerId,
        stripeSubscriptionId: values.stripeSubscriptionId,
        stripePriceId: values.stripePriceId,
        monthlyVoiceUsdCap: values.monthlyVoiceUsdCap,
        currentPeriodStart: values.currentPeriodStart,
        currentPeriodEnd: values.currentPeriodEnd,
      },
    });
  await writeBillingTimelineEvent(
    values.workspaceId,
    isCreate ? 'subscription.activated' : 'subscription.updated',
    isCreate
      ? `Subscribed to ${values.tier}`
      : `Subscription updated → ${values.tier} (${values.status})`,
    `Voice cap is now $${values.monthlyVoiceUsdCap}/mo. Billing period ends ${values.currentPeriodEnd.toISOString().slice(0, 10)}.`,
    {
      tier: values.tier,
      status: values.status,
      capUsd: values.monthlyVoiceUsdCap,
      stripeSubscriptionId: values.stripeSubscriptionId,
    },
  );

  // On real tier change, ping the workspace owner so they see it
  // immediately on the HUD / mobile / wherever they're online.
  if (prevTier !== values.tier) {
    const [owner] = await db
      .select({ userId: workspaceMember.userId })
      .from(workspaceMember)
      .where(
        and(eq(workspaceMember.workspaceId, values.workspaceId), eq(workspaceMember.role, 'owner')),
      )
      .limit(1);
    if (owner?.userId) {
      void inngest
        .send({
          name: 'conductor/notify',
          data: {
            workspaceId: values.workspaceId,
            userId: owner.userId,
            title: `Plan changed: ${prevTier} \u2192 ${values.tier}`,
            body: `Your voice cap is now $${values.monthlyVoiceUsdCap}/mo. New voice providers may be available.`,
            urgency: 'normal',
            source: 'billing',
            actionUrl: '/settings/billing/portal',
          },
        })
        .catch(() => {});
    }
  }
}

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ ok: false }, { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.verifyWebhook(body, sig);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_signature' }, { status: 400 });
  }

  // Stripe delivers each event at-least-once. Claim the event id by
  // inserting into the idempotency log; if a row already exists the
  // claim returns nothing and we 200 the duplicate without re-running
  // any side effects.
  const db = getDb();
  const claimed = await db
    .insert(stripeWebhookEvent)
    .values({
      eventId: event.id,
      type: event.type,
      workspaceId:
        event.data.object && typeof event.data.object === 'object'
          ? (extractWorkspaceId(event.data.object as Stripe.Subscription) ?? null)
          : null,
    })
    .onConflictDoNothing({ target: stripeWebhookEvent.eventId })
    .returning();
  if (claimed.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
        await upsertFromSubscription(event.data.object as Stripe.Subscription, true);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.resumed':
      case 'customer.subscription.paused':
      case 'customer.subscription.trial_will_end':
        await upsertFromSubscription(event.data.object as Stripe.Subscription, false);
        break;
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const wid = extractWorkspaceId(sub);
        if (wid) {
          await db
            .update(workspaceSubscription)
            .set({ tier: 'free', status: 'canceled', monthlyVoiceUsdCap: '0.00' })
            .where(eq(workspaceSubscription.workspaceId, wid));
          await writeBillingTimelineEvent(
            wid,
            'subscription.canceled',
            'Subscription canceled',
            'Reverted to free tier — voice cap reset to $0.',
            { stripeSubscriptionId: sub.id },
          );
        }
        break;
      }
      default:
        break;
    }
    await db
      .update(stripeWebhookEvent)
      .set({ processedAt: sql`now()` })
      .where(eq(stripeWebhookEvent.eventId, event.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    log.error('stripe.webhook.handler_failed', { eventType: event.type, eventId: event.id }, err);
    // Release the idempotency claim so Stripe's retry can re-run us.
    // Without this, a transient failure would permanently lose the event.
    await db
      .delete(stripeWebhookEvent)
      .where(eq(stripeWebhookEvent.eventId, event.id))
      .catch(() => {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
