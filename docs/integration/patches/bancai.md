# bancai → metu integration patch

Banking aggregator. Emits `transaction.created`, `balance.updated`,
`account.synced`. Exposes tools: `bancai.tag_transaction`,
`bancai.export_csv`.

Assumes Next.js 16 App Router + Drizzle. Adjust paths if your layout
differs.

## 1. New file — `src/lib/metu.ts`

```ts
import { z } from 'zod';

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

class MetuApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(new URL(path, env.METU_BASE_URL), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.METU_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = 'unknown';
    try {
      code = JSON.parse(text)?.error?.code ?? code;
    } catch {
      /* keep default */
    }
    throw new MetuApiError(res.status, code, `metu ${path} → ${res.status}`);
  }
  return schema.parse(text ? JSON.parse(text) : {});
}

const CaptureRes = z.object({ ok: z.boolean(), captureId: z.string().optional() });

/** Fire-and-forget capture. */
export function event(name: string, payload: Record<string, unknown>): Promise<void> {
  return call(
    '/api/sdk/v1/capture',
    { source: 'bancai', kind: name, payload, occurredAt: new Date().toISOString() },
    CaptureRes,
  ).then(() => undefined);
}

export const metu = {
  event,
  /** Used by the webhook route. */
  verifyWebhook(rawBody: string, signature: string): boolean {
    if (!env.METU_WEBHOOK_SECRET) return false;
    return verifyHmac(env.METU_WEBHOOK_SECRET, rawBody, signature);
  },
};

// ─── HMAC verifier (Node) ───────────────────────────────────────────────
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyHmac(secret: string, body: string, header: string): boolean {
  // header format: "t=<unix>,v1=<hex>"
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=', 2) as [string, string]));
  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return false;
  // Reject anything older than 5 minutes.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
```

## 2. New file — `src/app/api/metu/webhook/route.ts`

```ts
import { NextRequest } from 'next/server';
import { metu } from '@/lib/metu';
import { z } from 'zod';

const ToolInvoke = z.object({
  type: z.literal('tool.invoke'),
  callId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-metu-signature') ?? '';
  if (!metu.verifyWebhook(raw, sig)) return new Response('bad signature', { status: 401 });

  const parsed = ToolInvoke.safeParse(JSON.parse(raw));
  if (!parsed.success) return new Response('bad payload', { status: 400 });

  const { tool, args, callId } = parsed.data;
  // Dispatch synchronously for fast tools, or enqueue for long-running ones.
  // metu's tool-call ledger expects a tool.result event back via /api/sdk/v1/capture
  // with kind="tool.result" and payload={ callId, ok, result | error }.
  switch (tool) {
    case 'bancai.tag_transaction': {
      // TODO: actually tag the transaction in your DB
      void metu.event('tool.result', { callId, ok: true, result: { tagged: args.transactionId } });
      return Response.json({ ok: true });
    }
    case 'bancai.export_csv': {
      // TODO: enqueue an export job
      void metu.event('tool.result', { callId, ok: true, result: { queued: true } });
      return Response.json({ ok: true });
    }
    default:
      void metu.event('tool.result', { callId, ok: false, error: `unknown_tool:${tool}` });
      return Response.json({ ok: false, error: 'unknown_tool' }, { status: 400 });
  }
}
```

## 3. Hook into the transaction-create path

Find the function that inserts new transactions (usually in
`src/server/transactions.ts` or similar):

```ts
import { metu } from '@/lib/metu';

export async function importTransaction(input: TransactionInput) {
  const row = await db.insert(transactions).values(input).returning();

  void metu
    .event('transaction.created', {
      transactionId: row.id,
      accountId: row.accountId,
      amount: row.amount,
      currency: row.currency,
      counterparty: row.counterparty,
    })
    .catch(() => {
      /* metu is best-effort */
    });

  return row;
}
```

Do the same for `balance.updated` after reconciliation and
`account.synced` at the end of an institution sync.

## 4. `.env.example` additions

```env
METU_BASE_URL=http://localhost:24890
METU_HUB_URL=ws://localhost:24891
METU_ACCESS_TOKEN=
METU_WEBHOOK_SECRET=
```

## 5. Smoke

```pwsh
# In bancai dev shell:
node -e "import('./src/lib/metu.ts').then(m => m.metu.event('account.synced', { test: true })).then(() => console.log('ok'))"
```

Open metu `/timeline?source=bancai` — you should see the `account.synced`
row within a second.

## 6. Register tools in metu

For each tool you want the Conductor to be able to call, add a row to
`tool_acl` in metu (or wire a `webhook` integration via
`/settings/integrations`). Tools registered against a webhook satellite
get routed back through the route handler in step 2.
