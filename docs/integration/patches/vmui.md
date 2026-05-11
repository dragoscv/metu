# vmui → metu integration patch

Local VM controller. Emits `vm.started`, `vm.stopped`, `vm.snapshot_created`.
Exposes tools: `vmui.snapshot`, `vmui.restart`, `vmui.power_off`.

Assumes a Next.js (or Hono) backend that already spawns `vboxmanage` /
`qemu` / equivalent. The pattern works the same in Express or Fastify.

## 1. New file — `src/lib/metu.ts`

```ts
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';

const Env = z.object({
  METU_BASE_URL: z.string().url(),
  METU_ACCESS_TOKEN: z.string().min(20),
  METU_WEBHOOK_SECRET: z.string().min(20).optional(),
});

const env = Env.parse({
  METU_BASE_URL: process.env.METU_BASE_URL,
  METU_ACCESS_TOKEN: process.env.METU_ACCESS_TOKEN,
  METU_WEBHOOK_SECRET: process.env.METU_WEBHOOK_SECRET,
});

export async function event(kind: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(new URL('/api/sdk/v1/capture', env.METU_BASE_URL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.METU_ACCESS_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        source: 'vmui',
        kind,
        payload,
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch {
    /* best-effort */
  }
}

export function verifyWebhook(rawBody: string, header: string): boolean {
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
}
```

## 2. New file — `src/app/api/metu/webhook/route.ts`

```ts
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { event, verifyWebhook } from '@/lib/metu';
import { vmCommand } from '@/server/vm';

const ToolInvoke = z.object({
  type: z.literal('tool.invoke'),
  callId: z.string(),
  tool: z.string(),
  args: z.object({ vmId: z.string().min(1) }).passthrough(),
});

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get('x-metu-signature') ?? '')) {
    return new Response('bad signature', { status: 401 });
  }
  const parsed = ToolInvoke.safeParse(JSON.parse(raw));
  if (!parsed.success) return new Response('bad payload', { status: 400 });
  const { tool, args, callId } = parsed.data;

  // Long-running commands: ack fast, do work async, send tool.result later.
  // Quick read-only commands: do work inline and return.
  switch (tool) {
    case 'vmui.snapshot':
      queueMicrotask(async () => {
        try {
          const out = await vmCommand('snapshot', args.vmId, String(args.label ?? 'metu'));
          await event('tool.result', { callId, ok: true, result: { snapshot: out } });
          await event('vm.snapshot_created', { vmId: args.vmId, label: args.label });
        } catch (e) {
          await event('tool.result', { callId, ok: false, error: String(e) });
        }
      });
      return Response.json({ ok: true, queued: true });

    case 'vmui.restart':
      queueMicrotask(async () => {
        try {
          await vmCommand('restart', args.vmId);
          await event('tool.result', { callId, ok: true, result: { restarted: true } });
        } catch (e) {
          await event('tool.result', { callId, ok: false, error: String(e) });
        }
      });
      return Response.json({ ok: true, queued: true });

    case 'vmui.power_off':
      queueMicrotask(async () => {
        try {
          await vmCommand('poweroff', args.vmId);
          await event('tool.result', { callId, ok: true, result: { off: true } });
          await event('vm.stopped', { vmId: args.vmId, reason: 'metu_request' });
        } catch (e) {
          await event('tool.result', { callId, ok: false, error: String(e) });
        }
      });
      return Response.json({ ok: true, queued: true });

    default:
      await event('tool.result', { callId, ok: false, error: `unknown_tool:${tool}` });
      return Response.json({ ok: false, error: 'unknown_tool' }, { status: 400 });
  }
}
```

## 3. Hook into VM start/stop

```ts
// src/server/vm.ts
import { event } from '@/lib/metu';

export async function startVm(vmId: string) {
  await vmCommand('startvm', vmId);
  void event('vm.started', { vmId, startedAt: new Date().toISOString() });
}

export async function stopVm(vmId: string) {
  await vmCommand('controlvm', vmId, 'acpipowerbutton');
  void event('vm.stopped', { vmId, stoppedAt: new Date().toISOString(), reason: 'user' });
}
```

## 4. `.env.example` additions

```env
METU_BASE_URL=http://localhost:24890
METU_ACCESS_TOKEN=
METU_WEBHOOK_SECRET=
```

## 5. Smoke

```pwsh
node -e "(async () => { const m = await import('./src/lib/metu.ts'); await m.event('vm.started', { vmId: 'demo', test: true }); console.log('ok'); })()"
```

## 6. Security notes

- `vmui.power_off` and `vmui.restart` are destructive — leave them as
  `ask` mode in metu's `/settings/autonomy` so the user confirms each call.
- Never echo VM disk paths or credentials in event payloads.
- Rate-limit the webhook route — the same `callId` should be idempotent:
  if you see the same `callId` twice, return the cached result instead
  of running the command again.
