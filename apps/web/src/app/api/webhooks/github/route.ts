import { NextResponse } from 'next/server';
import { github } from '@metu/integrations';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const sig = req.headers.get('x-hub-signature-256');
  const payload = await req.text();
  if (!github.verifyGithubWebhook(payload, sig)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  // TODO: route by event type → enrich timeline & memory.
  // Use header `x-github-event` and the JSON.parse(payload) body.
  return NextResponse.json({ ok: true });
}
