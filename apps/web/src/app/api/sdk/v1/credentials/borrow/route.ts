/**
 * SDK v1 — POST /api/sdk/v1/credentials/borrow
 *
 * METU acts as the credential vault. Satellite apps (bancai/facturai/notai/…)
 * borrow scoped, short-lived tokens for an integration the user connected
 * once on /integrations. Apps never store the upstream OAuth grant directly.
 *
 * Bearer auth (`creds:borrow` scope) + per-integration ACL: the borrow only
 * succeeds when `tool_acl(creds_borrow, integrationId)` resolves to
 * `auto_with_undo` or `autopilot`. The user opts in per-integration on
 * /settings/autonomy.
 *
 * Response: the upstream provider access token, decrypted and returned over
 * TLS. (Future: signed proxy token + a forward proxy to mint scoped subtokens.)
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { integration, timelineEvent } from '@metu/db/schema';
import { open as openSealed } from '@metu/ai';
import { agent } from '@metu/core';
import { forbidden, hasScope, resolveSession, unauthorized } from '@/lib/bearer';
import { rateLimit } from '@/lib/ratelimit';
import { inngest } from '@/inngest/client';

export const runtime = 'nodejs';

const BorrowSchema = z.object({
  integrationId: z.string().uuid(),
  /** Free-form purpose recorded in audit log: 'reconcile-stripe-payouts' etc. */
  purpose: z.string().min(1).max(200),
  /** Requested validity in seconds (advisory; we always return upstream's lifetime). */
  ttlSec: z.number().int().min(30).max(3600).default(600),
});

export async function POST(req: Request) {
  const session = await resolveSession(req);
  if (!session) return unauthorized();
  if (!hasScope(session, 'creds:borrow')) return forbidden();

  const limited = await rateLimit('sdk-write', session.userId);
  if (limited) return limited;

  const json = await req.json().catch(() => null);
  const parsed = BorrowSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, parsed.data.integrationId),
        eq(integration.workspaceId, session.workspaceId),
      ),
    )
    .limit(1);
  if (!row) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  if (row.status !== 'active')
    return NextResponse.json({ ok: false, error: `integration_${row.status}` }, { status: 409 });
  if (!row.tokenCiphertext || !row.tokenIv) {
    return NextResponse.json({ ok: false, error: 'no_token' }, { status: 409 });
  }

  // Per-integration autonomy gate. Only auto modes allow synchronous borrow.
  const aclMode = await agent.resolveAcl(session.workspaceId, 'creds_borrow', row.id);
  if (aclMode === 'observe' || aclMode === 'ask') {
    return NextResponse.json(
      {
        ok: false,
        error: 'borrow_requires_approval',
        hint: `Set creds_borrow to auto_with_undo or autopilot for "${row.label}" on /settings/autonomy.`,
        aclMode,
      },
      { status: 403 },
    );
  }

  const tokenTag = (row.config as { tokenTag?: string })?.tokenTag;
  if (!tokenTag) {
    return NextResponse.json({ ok: false, error: 'token_tag_missing' }, { status: 500 });
  }

  let accessToken: string;
  try {
    accessToken = openSealed({
      ciphertext: row.tokenCiphertext,
      iv: row.tokenIv,
      tag: tokenTag,
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'unseal_failed' }, { status: 500 });
  }

  // Audit trail. We do NOT log the token itself.
  await db.insert(timelineEvent).values({
    workspaceId: session.workspaceId,
    userId: session.userId,
    kind: 'creds.borrowed',
    title: `Borrowed ${row.kind} credentials`,
    body: parsed.data.purpose.slice(0, 240),
    importance: 0.4,
    payload: {
      integrationId: row.id,
      kind: row.kind,
      label: row.label,
      purpose: parsed.data.purpose,
      ttlSec: parsed.data.ttlSec,
      borrower: session.clientId ?? 'unknown',
      aclMode,
    },
  });

  // expiresAt: prefer upstream's lifetime, fall back to ttlSec.
  const expiresAt =
    row.expiresAt && row.expiresAt > new Date()
      ? row.expiresAt
      : new Date(Date.now() + parsed.data.ttlSec * 1000);

  await inngest.send({
    name: 'conductor/observe',
    data: {
      workspaceId: session.workspaceId,
      eventKind: 'creds.borrowed',
      payload: {
        integrationId: row.id,
        kind: row.kind,
        purpose: parsed.data.purpose,
        borrower: session.clientId ?? 'unknown',
      },
    },
  });

  return NextResponse.json({
    ok: true,
    integrationId: row.id,
    kind: row.kind,
    accessToken,
    expiresAt: expiresAt.toISOString(),
  });
}
