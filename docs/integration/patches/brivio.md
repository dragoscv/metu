# brivio → metu integration patch

Document + invoicing SaaS. Emits `document.uploaded`, `invoice.issued`,
`invoice.paid`. Exposes tools: `brivio.send_to_anaf`,
`brivio.create_payment_link`, `brivio.tag_document`.

Brivio uses Next.js 16 + Drizzle + Stripe — same golden stack as metu —
so this patch is the longest, but it's also the closest to copy-paste.

## 1. New file — `src/lib/metu.ts`

```ts
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';

const Env = z.object({
  METU_BASE_URL: z.string().url(),
  METU_ACCESS_TOKEN: z.string().min(20),
  METU_HUB_URL: z.string().url().optional(),
  METU_WEBHOOK_SECRET: z.string().min(20).optional(),
});

const env = Env.parse({
  METU_BASE_URL: process.env.METU_BASE_URL,
  METU_ACCESS_TOKEN: process.env.METU_ACCESS_TOKEN,
  METU_HUB_URL: process.env.METU_HUB_URL,
  METU_WEBHOOK_SECRET: process.env.METU_WEBHOOK_SECRET,
});

export class MetuApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function capture(kind: string, payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(new URL('/api/sdk/v1/capture', env.METU_BASE_URL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.METU_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'brivio',
        kind,
        payload,
        occurredAt: new Date().toISOString(),
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { captureId?: string };
    return body.captureId ?? null;
  } catch {
    return null;
  }
}

export const metu = {
  event: capture,
  verifyWebhook(rawBody: string, header: string): boolean {
    if (!env.METU_WEBHOOK_SECRET) return false;
    const parts = Object.fromEntries(
      header.split(',').map((kv) => kv.split('=', 2) as [string, string]),
    );
    const ts = parts.t;
    const sig = parts.v1;
    if (!ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const expected = createHmac('sha256', env.METU_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest('hex');
    if (expected.length !== sig.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  },
};
```

## 2. New file — `src/app/api/metu/webhook/route.ts`

```ts
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { metu } from '@/lib/metu';
import { sendInvoiceToAnaf, createStripePaymentLink, tagDocument } from '@/server/brivio';

const ToolInvoke = z.discriminatedUnion('tool', [
  z.object({
    type: z.literal('tool.invoke'),
    callId: z.string(),
    tool: z.literal('brivio.send_to_anaf'),
    args: z.object({ invoiceId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal('tool.invoke'),
    callId: z.string(),
    tool: z.literal('brivio.create_payment_link'),
    args: z.object({ invoiceId: z.string().uuid(), expiresInDays: z.number().int().positive().max(60).optional() }),
  }),
  z.object({
    type: z.literal('tool.invoke'),
    callId: z.string(),
    tool: z.literal('brivio.tag_document'),
    args: z.object({ documentId: z.string().uuid(), tags: z.array(z.string().min(1).max(40)).max(20) }),
  }),
]);

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!metu.verifyWebhook(raw, req.headers.get('x-metu-signature') ?? '')) {
    return new Response('bad signature', { status: 401 });
  }
  const parsed = ToolInvoke.safeParse(JSON.parse(raw));
  if (!parsed.success) return new Response('bad payload', { status: 400 });
  const env = parsed.data;

  try {
    if (env.tool === 'brivio.send_to_anaf') {
      const result = await sendInvoiceToAnaf(env.args.invoiceId);
      void metu.event('tool.result', { callId: env.callId, ok: true, result });
      return Response.json({ ok: true, result });
    }
    if (env.tool === 'brivio.create_payment_link') {
      const url = await createStripePaymentLink(env.args.invoiceId, env.args.expiresInDays ?? 14);
      void metu.event('tool.result', { callId: env.callId, ok: true, result: { url } });
      return Response.json({ ok: true, url });
    }
    if (env.tool === 'brivio.tag_document') {
      await tagDocument(env.args.documentId, env.args.tags);
      void metu.event('tool.result', { callId: env.callId, ok: true, result: { tagged: env.args.documentId } });
      return Response.json({ ok: true });
    }
  } catch (e) {
    void metu.event('tool.result', { callId: env.callId, ok: false, error: String(e) });
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
  return new Response('unhandled', { status: 400 });
}
```

## 3. Hook into invoice/document mutations

```ts
// src/server/invoices.ts
import { metu } from '@/lib/metu';

export async function issueInvoice(input: IssueInvoiceInput) {
  const inv = await db.insert(invoices).values(input).returning();
  void metu.event('invoice.issued', {
    invoiceId: inv.id,
    customerId: inv.customerId,
    amount: inv.amount,
    currency: inv.currency,
    dueDate: inv.dueDate,
  });
  return inv;
}

export async function markInvoicePaid(invoiceId: string) {
  await db.update(invoices).set({ paidAt: new Date() }).where(eq(invoices.id, invoiceId));
  void metu.event('invoice.paid', { invoiceId, paidAt: new Date().toISOString() });
}
```

```ts
// src/server/documents.ts
import { metu } from '@/lib/metu';

export async function uploadDocument(input: UploadInput) {
  const doc = await persist(input);
  void metu.event('document.uploaded', {
    documentId: doc.id,
    filename: doc.filename,
    mime: doc.mime,
    sizeBytes: doc.sizeBytes,
  });
  return doc;
}
```

## 4. `.env.example` additions

```env
METU_BASE_URL=http://localhost:24890
METU_HUB_URL=ws://localhost:24891
METU_ACCESS_TOKEN=
METU_WEBHOOK_SECRET=
```

## 5. Smoke

```pwsh
# inside the brivio repo:
node -e "(async () => { const m = await import('./src/lib/metu.ts'); await m.metu.event('invoice.issued', { test: true, invoiceId: 'demo' }); console.log('ok'); })()"
```

Then in metu: `/timeline?source=brivio` should show the `invoice.issued`
row, and `/audit` will list any tool calls the Conductor sends back.

## 6. Romanian-specific notes

- `brivio.send_to_anaf` should be `ask` mode in metu — it touches a
  government API and is hard to reverse. Set
  `tool_acl.mode='ask'` for this tool in metu's `/settings/autonomy`.
- ANAF e-Factura responses can take 30+ seconds. The webhook handler
  returns 200 immediately and emits `tool.result` only after ANAF
  acknowledges. metu's `/audit` shows the `tool_call` as `running` in
  the meantime.
- PII: don't put CNP / CUI into event payloads. Use IDs only; metu can
  recall the full row through your read endpoint when it needs to.
