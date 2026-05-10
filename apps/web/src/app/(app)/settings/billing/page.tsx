import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Page, PageHeader, PageSection, Card, Badge, Button } from '@metu/ui';
import {
  getCurrentSubscription,
  getVoiceUsageDailyAction,
  listBillingTiers,
  openPortalAction,
  simulateSubscriptionAction,
  startCheckoutAction,
  type BillingTier,
} from '@/app/actions/billing';
import { getVoiceCapStateAction } from '@/app/actions/presence';
import { VoiceBudgetMeter } from '@/components/voice-budget-meter';
import { VoiceUsageChart } from '@/components/voice-usage-chart';

const TIER_RANK: Record<BillingTier, number> = {
  free: 0,
  starter: 1,
  pro: 2,
  pro_plus: 3,
  enterprise: 4,
};

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect('/sign-in');

  const [sub, tiers, voiceCap, voiceDaily] = await Promise.all([
    getCurrentSubscription(),
    listBillingTiers(),
    getVoiceCapStateAction(),
    getVoiceUsageDailyAction(14),
  ]);

  const sp = await searchParams;
  const justSubscribed = sp.ok === '1';
  const cancelled = sp.cancelled === '1';

  return (
    <Page>
      <PageHeader
        title="Billing"
        description="Pick a tier — voice usage is metered against the monthly cap. Cancel anytime."
      />

      {justSubscribed ? (
        <Card>
          <p className="text-sm text-emerald-300">
            Subscription updated. Stripe webhooks will refresh your tier within a few seconds.
          </p>
        </Card>
      ) : null}
      {cancelled ? (
        <Card>
          <p className="text-sm text-amber-300">
            Checkout cancelled — no charge made. You're still on the {sub.tier} tier.
          </p>
        </Card>
      ) : null}

      <PageSection
        title="Current plan"
        description="Live voice spend resets at the start of each billing period."
      >
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{sub.tier.toUpperCase()}</Badge>
            <span className="text-sm text-zinc-400">status: {sub.status}</span>
            <span className="text-sm text-zinc-400">
              cap: <span className="font-mono">${sub.capUsd.toFixed(2)}/mo</span>
            </span>
            {sub.hasStripeCustomer ? (
              <form action={openPortalAction}>
                <Button type="submit" variant="ghost" size="sm">
                  Manage in Stripe
                </Button>
              </form>
            ) : null}
          </div>
          <div className="mt-3">
            <VoiceBudgetMeter initial={voiceCap} refetch={getVoiceCapStateAction} />
          </div>
        </Card>
      </PageSection>

      <PageSection
        title="Voice usage"
        description="Daily breakdown by lane. Updates every minute. Export the current month as CSV."
      >
        <Card>
          <div className="mb-3 flex justify-end">
            <a
              href="/api/billing/voice-usage"
              className="text-xs text-zinc-300 underline hover:text-zinc-100"
            >
              Download CSV →
            </a>
          </div>
          <VoiceUsageChart initial={voiceDaily} refetch={getVoiceUsageDailyAction} />
        </Card>
      </PageSection>

      <PageSection
        title="Tiers"
        description="Stripe Checkout opens in this window. Tier changes apply on the next billing period."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {tiers.map((t) => {
            const isCurrent = sub.tier === t.tier;
            const isUpgrade = TIER_RANK[t.tier] > TIER_RANK[sub.tier];
            const disabled = isCurrent || !t.priceId;
            return (
              <Card key={t.tier}>
                <div className="flex items-baseline justify-between">
                  <h3 className="text-lg font-semibold">{t.name}</h3>
                  <span className="font-mono text-sm">
                    ${t.priceUsd}
                    <span className="text-zinc-500">/mo</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Voice budget: <span className="font-mono">${t.capUsd}/mo</span>
                </p>
                <ul className="mt-3 space-y-1 text-xs text-zinc-300">
                  {t.highlights.map((h) => (
                    <li key={h}>• {h}</li>
                  ))}
                </ul>
                <div className="mt-4">
                  {isCurrent ? (
                    <Badge>Current</Badge>
                  ) : t.priceId ? (
                    <form action={startCheckoutAction}>
                      <input type="hidden" name="tier" value={t.tier} />
                      <Button
                        type="submit"
                        variant={isUpgrade ? 'default' : 'ghost'}
                        size="sm"
                        disabled={disabled}
                      >
                        {isUpgrade ? 'Upgrade' : 'Switch'}
                      </Button>
                    </form>
                  ) : t.tier === 'free' ? (
                    <span className="text-xs text-zinc-500">Default</span>
                  ) : (
                    <span className="text-xs text-zinc-500">
                      Set <code>STRIPE_PRICE_{t.tier.toUpperCase()}</code> to enable
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </PageSection>

      {process.env.NODE_ENV !== 'production' ? (
        <PageSection
          title="Developer"
          description="Bypass Stripe and seed the subscription locally to QA the cap meter and billing UI."
        >
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              {(['free', 'starter', 'pro', 'pro_plus', 'enterprise'] as BillingTier[]).map((t) => (
                <form key={t} action={simulateSubscriptionAction}>
                  <input type="hidden" name="tier" value={t} />
                  <Button type="submit" variant="ghost" size="sm">
                    Simulate {t}
                  </Button>
                </form>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              Writes a fake `cus_dev_simulated` row in `workspace_subscription`. Disabled when
              <code className="mx-1">NODE_ENV=production</code>.
            </p>
          </Card>
        </PageSection>
      ) : null}
    </Page>
  );
}
