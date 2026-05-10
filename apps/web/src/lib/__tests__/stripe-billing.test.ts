import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  buildSubscriptionUpsertValues,
  extractWorkspaceId,
  normaliseStatus,
  priceMap,
} from '../stripe-billing';

const ENV = {
  STRIPE_PRICE_STARTER: 'price_starter_xxx',
  STRIPE_PRICE_PRO: 'price_pro_xxx',
  STRIPE_PRICE_PRO_PLUS: 'price_pro_plus_xxx',
  STRIPE_PRICE_ENTERPRISE: 'price_enterprise_xxx',
} as unknown as NodeJS.ProcessEnv;

function makeSub(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_test_123',
    customer: 'cus_test_123',
    status: 'active',
    metadata: { workspaceId: 'b3b8a4c2-1f0e-4a4b-9d9c-1f2a3b4c5d6e' },
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_pro_xxx' },
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
    current_period_start: 1_700_000_000,
    current_period_end: 1_702_592_000,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('normaliseStatus', () => {
  it('passes through known statuses', () => {
    expect(normaliseStatus('active')).toBe('active');
    expect(normaliseStatus('canceled')).toBe('canceled');
    expect(normaliseStatus('trialing')).toBe('trialing');
  });

  it('falls back to incomplete for unknowns', () => {
    expect(normaliseStatus('mystery')).toBe('incomplete');
    expect(normaliseStatus('')).toBe('incomplete');
  });
});

describe('priceMap', () => {
  it('maps configured price IDs to tiers + caps', () => {
    const map = priceMap(ENV);
    expect(map[ENV.STRIPE_PRICE_PRO!]).toEqual({ tier: 'pro', capUsd: '15.00' });
    expect(map[ENV.STRIPE_PRICE_ENTERPRISE!]).toEqual({ tier: 'enterprise', capUsd: '200.00' });
  });

  it('omits unset env vars', () => {
    const map = priceMap({} as NodeJS.ProcessEnv);
    expect(Object.keys(map)).toHaveLength(0);
  });
});

describe('extractWorkspaceId', () => {
  it('reads from subscription metadata first', () => {
    const sub = makeSub();
    expect(extractWorkspaceId(sub)).toBe('b3b8a4c2-1f0e-4a4b-9d9c-1f2a3b4c5d6e');
  });

  it('falls back to expanded customer metadata', () => {
    const sub = makeSub({
      metadata: {},
      customer: {
        id: 'cus_test_123',
        metadata: { workspaceId: 'fallback-ws' },
      } as unknown as Stripe.Customer,
    });
    expect(extractWorkspaceId(sub)).toBe('fallback-ws');
  });

  it('returns null when nothing tags the workspace', () => {
    const sub = makeSub({ metadata: {} });
    expect(extractWorkspaceId(sub)).toBeNull();
  });
});

describe('buildSubscriptionUpsertValues', () => {
  it('produces full row for an active pro subscription', () => {
    const v = buildSubscriptionUpsertValues(makeSub(), ENV, new Date('2024-01-01T00:00:00Z'));
    expect(v).not.toBeNull();
    expect(v!.tier).toBe('pro');
    expect(v!.monthlyVoiceUsdCap).toBe('15.00');
    expect(v!.status).toBe('active');
    expect(v!.stripeCustomerId).toBe('cus_test_123');
    expect(v!.stripeSubscriptionId).toBe('sub_test_123');
    expect(v!.stripePriceId).toBe('price_pro_xxx');
    expect(v!.currentPeriodStart.getTime()).toBe(1_700_000_000_000);
    expect(v!.currentPeriodEnd.getTime()).toBe(1_702_592_000_000);
  });

  it('falls back to free + 30-day window when price is unknown and bounds missing', () => {
    const now = new Date('2024-01-01T00:00:00Z');
    const sub = makeSub({
      items: {
        data: [{ id: 'si_1', price: { id: 'price_unknown' } }],
      } as unknown as Stripe.ApiList<Stripe.SubscriptionItem>,
      current_period_start: undefined as unknown as number,
      current_period_end: undefined as unknown as number,
    });
    const v = buildSubscriptionUpsertValues(sub, ENV, now);
    expect(v!.tier).toBe('free');
    expect(v!.monthlyVoiceUsdCap).toBe('0.00');
    expect(v!.currentPeriodStart.getTime()).toBe(now.getTime());
    expect(v!.currentPeriodEnd.getTime()).toBe(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  });

  it('returns null when no workspace tag exists', () => {
    const sub = makeSub({ metadata: {} });
    expect(buildSubscriptionUpsertValues(sub, ENV)).toBeNull();
  });

  it('coerces unknown stripe statuses to incomplete', () => {
    const sub = makeSub({ status: 'something_new' as Stripe.Subscription.Status });
    const v = buildSubscriptionUpsertValues(sub, ENV);
    expect(v!.status).toBe('incomplete');
  });

  it('reads period bounds from item when subscription-level bounds are missing', () => {
    const sub = makeSub({
      current_period_start: undefined as unknown as number,
      current_period_end: undefined as unknown as number,
    });
    const v = buildSubscriptionUpsertValues(sub, ENV);
    expect(v!.currentPeriodStart.getTime()).toBe(1_700_000_000_000);
    expect(v!.currentPeriodEnd.getTime()).toBe(1_702_592_000_000);
  });
});
