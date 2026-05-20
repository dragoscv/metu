/**
 * Trial banner — surfaces in the app shell when the workspace
 * subscription is in `trialing` status with <= 7 days left, OR when a
 * paid subscription has < 3 days remaining (Stripe will renew, but a
 * card-failure surfaces here first).
 *
 * Server component — fetches once per RSC pass, no client JS.
 */
import Link from 'next/link';
import { Card } from '@metu/ui';
import { getCurrentSubscription } from '@/app/actions/billing';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function TrialBanner() {
  const sub = await getCurrentSubscription();
  if (!sub.currentPeriodEnd) return null;

  const remainingMs = sub.currentPeriodEnd.getTime() - Date.now();
  const remainingDays = Math.ceil(remainingMs / DAY_MS);

  // Only surface for trialing (<=7d left) or active sub <3d (renewal warning).
  const isTrial = sub.status === 'trialing' && remainingDays <= 7 && remainingDays >= 0;
  const isPaidSoon =
    sub.status === 'active' && sub.tier !== 'free' && remainingDays <= 3 && remainingDays >= 0;
  if (!isTrial && !isPaidSoon) return null;

  const tone = remainingDays <= 1 ? 'amber' : 'zinc';
  const label = isTrial
    ? remainingDays <= 0
      ? 'Trial ends today'
      : `Trial ends in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`
    : `Renews in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`;
  const cta = isTrial ? 'Pick a plan →' : 'Manage billing →';

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm ${tone === 'amber' ? 'text-amber-300' : 'text-zinc-300'}`}>
          {label}
          {isTrial ? ' — keep your conductor + voice features by upgrading before then.' : null}
        </span>
        <Link href="/settings/billing" className="text-xs text-zinc-100 underline">
          {cta}
        </Link>
      </div>
    </Card>
  );
}
