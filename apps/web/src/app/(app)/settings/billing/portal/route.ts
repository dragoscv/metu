/**
 * Stripe billing portal deep-link.
 *
 * Hitting GET /settings/billing/portal triggers the same server action
 * the manage button uses, so notification actionUrls and external links
 * can take the user straight to Stripe without an extra click.
 *
 * If there's no Stripe customer yet, falls back to /settings/billing
 * with a `?portal=missing` flag so the page can show a hint.
 */
import { redirect } from 'next/navigation';
import { auth } from '@metu/auth';
import { eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { workspaceSubscription } from '@metu/db/schema';
import { stripe } from '@metu/integrations';

export async function GET() {
  const session = await auth();
  if (!session) redirect('/sign-in?next=/settings/billing/portal');
  const db = getDb();
  const [row] = await db
    .select({ customerId: workspaceSubscription.stripeCustomerId })
    .from(workspaceSubscription)
    .where(eq(workspaceSubscription.workspaceId, session.user.workspaceId))
    .limit(1);
  if (!row?.customerId) redirect('/settings/billing?portal=missing');
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? 'http://localhost:24890';
  const portal = await stripe.stripe().billingPortal.sessions.create({
    customer: row.customerId,
    return_url: `${baseUrl}/settings/billing`,
  });
  redirect(portal.url);
}
