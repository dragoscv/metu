/** Stripe — webhook verification + revenue event ingestion. */
import Stripe from 'stripe';

let _stripe: Stripe | undefined;

export function stripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  // Don't pin apiVersion; let the SDK use its default to avoid type drift.
  _stripe = new Stripe(key);
  return _stripe;
}

export function verifyWebhook(payload: string | Buffer, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return stripe().webhooks.constructEvent(payload, signature, secret);
}
