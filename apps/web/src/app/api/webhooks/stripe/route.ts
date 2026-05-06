import { NextResponse } from 'next/server';
import { stripe } from '@metu/integrations';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ ok: false }, { status: 400 });
  const body = await req.text();
  try {
    const event = stripe.verifyWebhook(body, sig);
    // TODO: persist revenue events tagged to workspace/project.
    console.info('[stripe webhook]', event.type);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
