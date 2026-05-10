'use server';
/**
 * Workspace member management — owner-only mutations for adding,
 * removing, and changing the role of users in the current workspace.
 *
 * V1 (existing-user add) lives in `addMemberAction`. The
 * `inviteByEmailAction` below covers the "stranger" case: it stamps a
 * single-use token into `workspace_invite` and emails it via Resend (or
 * logs it when RESEND_API_KEY isn't configured — useful in dev).
 */
import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, ne, isNull, gt } from 'drizzle-orm';
import { z } from 'zod';
import { auth } from '@metu/auth';
import { getDb } from '@metu/db';
import { user, workspace, workspaceInvite, workspaceMember } from '@metu/db/schema';
import { timelineEvent } from '@metu/db/schema';
import { log } from '@/lib/logger';

const RoleSchema = z.enum(['owner', 'admin', 'member']);

/**
 * Emit a timeline_event row for workspace-admin actions so they show up
 * in /settings/audit (6C). Best-effort \u2014 a failure here must not break
 * the underlying action.
 */
async function recordAuditEvent(input: {
  workspaceId: string;
  actorUserId: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(timelineEvent).values({
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      importance: 0.4,
    });
  } catch (err) {
    log.warn('workspace.audit.event_insert_failed', { kind: input.kind }, err);
  }
}

async function requireOwner(): Promise<
  { ok: true; workspaceId: string; userId: string } | { ok: false; error: string }
> {
  const session = await auth();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const db = getDb();
  const [m] = await db
    .select({ role: workspaceMember.role })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.userId, session.user.id),
        eq(workspaceMember.workspaceId, session.user.workspaceId),
      ),
    )
    .limit(1);
  if (!m || m.role !== 'owner') return { ok: false, error: 'forbidden' };
  return {
    ok: true,
    workspaceId: session.user.workspaceId,
    userId: session.user.id,
  };
}

const AddMemberSchema = z.object({
  email: z.email(),
  role: RoleSchema.default('member'),
});

export async function addMemberAction(
  input: z.input<typeof AddMemberSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireOwner();
  if (!guard.ok) return guard;
  const parsed = AddMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  // Owner role can only be granted from another flow (transfer-ownership);
  // adding a brand-new member as owner would silently dilute the role.
  if (parsed.data.role === 'owner') {
    return { ok: false, error: 'cannot_add_as_owner' };
  }

  const db = getDb();
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, parsed.data.email.toLowerCase()))
    .limit(1);
  if (!u) {
    return {
      ok: false,
      error: 'user_not_found_invite_required',
    };
  }

  const [existing] = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(eq(workspaceMember.workspaceId, guard.workspaceId), eq(workspaceMember.userId, u.id)),
    )
    .limit(1);
  if (existing) return { ok: false, error: 'already_member' };

  await db.insert(workspaceMember).values({
    workspaceId: guard.workspaceId,
    userId: u.id,
    role: parsed.data.role,
  });

  log.info('workspace.member.added', {
    workspaceId: guard.workspaceId,
    actorId: guard.userId,
    targetUserId: u.id,
    role: parsed.data.role,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.member.added',
    title: `Added ${parsed.data.email} as ${parsed.data.role}`,
    payload: { email: parsed.data.email, role: parsed.data.role, targetUserId: u.id },
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

const ChangeRoleSchema = z.object({
  targetUserId: z.string().uuid(),
  role: RoleSchema,
});

export async function changeMemberRoleAction(
  input: z.input<typeof ChangeRoleSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireOwner();
  if (!guard.ok) return guard;
  const parsed = ChangeRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  // Demoting yourself from owner would lock you out of governance.
  // Force going through the (separate) ownership-transfer flow first.
  if (parsed.data.targetUserId === guard.userId && parsed.data.role !== 'owner') {
    return { ok: false, error: 'cannot_demote_self' };
  }

  const db = getDb();
  const updated = await db
    .update(workspaceMember)
    .set({ role: parsed.data.role })
    .where(
      and(
        eq(workspaceMember.workspaceId, guard.workspaceId),
        eq(workspaceMember.userId, parsed.data.targetUserId),
      ),
    )
    .returning();
  if (updated.length === 0) return { ok: false, error: 'not_found' };

  log.info('workspace.member.role_changed', {
    workspaceId: guard.workspaceId,
    actorId: guard.userId,
    targetUserId: parsed.data.targetUserId,
    role: parsed.data.role,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.member.role_changed',
    title: `Changed role to ${parsed.data.role}`,
    payload: { role: parsed.data.role, targetUserId: parsed.data.targetUserId },
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

const RemoveSchema = z.object({ targetUserId: z.string().uuid() });

export async function removeMemberAction(
  input: z.input<typeof RemoveSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireOwner();
  if (!guard.ok) return guard;
  const parsed = RemoveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  if (parsed.data.targetUserId === guard.userId) {
    return { ok: false, error: 'cannot_remove_self' };
  }

  const db = getDb();
  const deleted = await db
    .delete(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, guard.workspaceId),
        eq(workspaceMember.userId, parsed.data.targetUserId),
        // Belt + braces: never let a delete strip the last owner.
        ne(workspaceMember.role, 'owner'),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    return { ok: false, error: 'cannot_remove_last_owner' };
  }

  log.info('workspace.member.removed', {
    workspaceId: guard.workspaceId,
    actorId: guard.userId,
    targetUserId: parsed.data.targetUserId,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.member.removed',
    title: `Removed a member`,
    payload: { targetUserId: parsed.data.targetUserId },
  });

  revalidatePath('/settings/team');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invitations (stranger flow)
// ---------------------------------------------------------------------------

const INVITE_TTL_DAYS = 7;
const INVITE_RESEND_FROM = process.env.RESEND_FROM ?? 'metu <hello@metu.app>';

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

async function sendInviteEmail(input: {
  to: string;
  workspaceName: string;
  inviterName: string | null;
  url: string;
}): Promise<'sent' | 'logged' | 'failed'> {
  const key = process.env.RESEND_API_KEY;
  const subject = `You're invited to join ${input.workspaceName} on metu`;
  const text = [
    `${input.inviterName ?? 'A teammate'} invited you to join the "${input.workspaceName}" workspace on metu.`,
    '',
    `Accept the invitation:`,
    input.url,
    '',
    `This link expires in ${INVITE_TTL_DAYS} days and can only be used once.`,
    `If you weren't expecting this, you can safely ignore the email.`,
  ].join('\n');
  const html = renderInviteHtml({
    workspaceName: input.workspaceName,
    inviterName: input.inviterName ?? 'A teammate',
    url: input.url,
    ttlDays: INVITE_TTL_DAYS,
  });
  if (!key) {
    log.info('workspace.invite.email_skipped_no_key', {
      to: input.to,
      url: input.url,
    });
    return 'logged';
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: INVITE_RESEND_FROM,
        to: [input.to],
        subject,
        text,
        html,
      }),
    });
    return r.ok ? 'sent' : 'failed';
  } catch (err) {
    log.error('workspace.invite.email_failed', { to: input.to }, err);
    return 'failed';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal, mobile-friendly HTML email. Inlined styles only — most
 * email clients strip <style> blocks. No external assets, no JS, no
 * web fonts. Tested mentally against Gmail (web + iOS), Apple Mail,
 * and Outlook 2019. Light/dark agnostic via system colors.
 */
function renderInviteHtml(input: {
  workspaceName: string;
  inviterName: string;
  url: string;
  ttlDays: number;
}): string {
  const ws = escapeHtml(input.workspaceName);
  const inviter = escapeHtml(input.inviterName);
  const url = escapeHtml(input.url);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>You're invited to ${ws}</title></head>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e7e7ea;overflow:hidden;">
            <tr><td style="padding:28px 28px 0 28px;">
              <div style="font-size:13px;letter-spacing:0.04em;color:#6e6e73;text-transform:uppercase;">metu</div>
              <h1 style="margin:8px 0 4px 0;font-size:22px;line-height:1.3;font-weight:600;color:#1d1d1f;">You're invited to <span style="color:#0066cc;">${ws}</span></h1>
              <p style="margin:12px 0 0 0;font-size:15px;line-height:1.55;color:#3a3a3c;">${inviter} added you to the <strong style="color:#1d1d1f;">${ws}</strong> workspace on metu, your personal AI operating system.</p>
            </td></tr>
            <tr><td style="padding:24px 28px 8px 28px;">
              <a href="${url}" style="display:inline-block;background:#0066cc;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Accept invitation</a>
            </td></tr>
            <tr><td style="padding:8px 28px 24px 28px;">
              <p style="margin:0;font-size:12px;line-height:1.55;color:#6e6e73;">Or paste this link into your browser:</p>
              <p style="margin:4px 0 0 0;font-size:12px;line-height:1.55;color:#3a3a3c;word-break:break-all;">${url}</p>
            </td></tr>
            <tr><td style="padding:0 28px 28px 28px;">
              <hr style="border:none;border-top:1px solid #e7e7ea;margin:0 0 16px 0;"/>
              <p style="margin:0;font-size:12px;line-height:1.55;color:#6e6e73;">This invitation expires in ${input.ttlDays} days and can only be used once. If you didn't expect this email, you can ignore it safely &mdash; no account is created until you accept.</p>
            </td></tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;color:#86868b;">Sent by metu &middot; <a href="https://metu.ro" style="color:#86868b;text-decoration:underline;">metu.ro</a></p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const InviteSchema = z.object({
  email: z.email(),
  role: z.enum(['admin', 'member']).default('member'),
});

export type InviteResult =
  | { ok: true; emailStatus: 'sent' | 'logged' | 'failed'; inviteUrl: string | null }
  | { ok: false; error: string };

export async function inviteByEmailAction(
  input: z.input<typeof InviteSchema>,
): Promise<InviteResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  const parsed = InviteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'invalid' };
  }
  const email = parsed.data.email.toLowerCase();
  const db = getDb();

  // Don't double-invite an existing member.
  const [existingMember] = await db
    .select({ id: workspaceMember.userId })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(and(eq(workspaceMember.workspaceId, guard.workspaceId), eq(user.email, email)))
    .limit(1);
  if (existingMember) return { ok: false, error: 'already_member' };

  // Revoke any prior live invites for the same email so the most recent
  // link is the only working one.
  const now = new Date();
  await db
    .update(workspaceInvite)
    .set({ revokedAt: now })
    .where(
      and(
        eq(workspaceInvite.workspaceId, guard.workspaceId),
        eq(workspaceInvite.email, email),
        isNull(workspaceInvite.claimedAt),
        isNull(workspaceInvite.revokedAt),
        gt(workspaceInvite.expiresAt, now),
      ),
    );

  const token = randomBytes(24).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(workspaceInvite).values({
    workspaceId: guard.workspaceId,
    email,
    role: parsed.data.role,
    tokenHash,
    invitedByUserId: guard.userId,
    expiresAt,
  });

  // Best-effort: look up display name + workspace name for the email.
  const [[wsRow], [inviterRow]] = await Promise.all([
    db
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, guard.workspaceId))
      .limit(1),
    db.select({ name: user.name }).from(user).where(eq(user.id, guard.userId)).limit(1),
  ]);

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:24890';
  const inviteUrl = `${base.replace(/\/+$/, '')}/invite/${token}`;
  const emailStatus = await sendInviteEmail({
    to: email,
    workspaceName: wsRow?.name ?? 'a workspace',
    inviterName: inviterRow?.name ?? null,
    url: inviteUrl,
  });

  log.info('workspace.invite.sent', {
    workspaceId: guard.workspaceId,
    actorId: guard.userId,
    email,
    role: parsed.data.role,
    emailStatus,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.invite.sent',
    title: `Invited ${email} as ${parsed.data.role}`,
    payload: { email, role: parsed.data.role, emailStatus },
  });

  revalidatePath('/settings/team');
  // We never return the token plaintext to the inviter when the email
  // succeeded — the invitee sees it via email. In dev (no key), surface
  // the URL so the developer can test the claim flow.
  return {
    ok: true,
    emailStatus,
    inviteUrl: emailStatus === 'logged' ? inviteUrl : null,
  };
}

const RevokeSchema = z.object({ inviteId: z.string().uuid() });

export async function revokeInviteAction(
  input: z.input<typeof RevokeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireOwner();
  if (!guard.ok) return guard;
  const parsed = RevokeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const db = getDb();
  const updated = await db
    .update(workspaceInvite)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(workspaceInvite.id, parsed.data.inviteId),
        eq(workspaceInvite.workspaceId, guard.workspaceId),
        isNull(workspaceInvite.claimedAt),
        isNull(workspaceInvite.revokedAt),
      ),
    )
    .returning();
  if (updated.length === 0) return { ok: false, error: 'not_found' };

  log.info('workspace.invite.revoked', {
    workspaceId: guard.workspaceId,
    actorId: guard.userId,
    inviteId: parsed.data.inviteId,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.invite.revoked',
    title: 'Revoked a pending invite',
    payload: { inviteId: parsed.data.inviteId },
  });
  revalidatePath('/settings/team');
  return { ok: true };
}

const ClaimSchema = z.object({ token: z.string().min(20).max(200) });

export type ClaimResult =
  | { ok: true; workspaceId: string; workspaceName: string }
  | {
      ok: false;
      error: 'unauthenticated' | 'invalid' | 'expired' | 'used' | 'revoked' | 'email_mismatch';
    };

/**
 * Claim flow. The invitee must already be signed in (the /invite/[token]
 * page handles redirecting them through sign-in first). On success, we
 * insert a workspace_member row and mark the invite claimed.
 */
export async function claimInviteAction(input: z.input<typeof ClaimSchema>): Promise<ClaimResult> {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, error: 'unauthenticated' };
  }
  const parsed = ClaimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const db = getDb();
  const tokenHash = hashToken(parsed.data.token);
  const [inv] = await db
    .select()
    .from(workspaceInvite)
    .where(eq(workspaceInvite.tokenHash, tokenHash))
    .limit(1);
  if (!inv) return { ok: false, error: 'invalid' };
  if (inv.revokedAt) return { ok: false, error: 'revoked' };
  if (inv.claimedAt) return { ok: false, error: 'used' };
  if (inv.expiresAt.getTime() < Date.now()) return { ok: false, error: 'expired' };

  // Email-match guard: don't let an arbitrary signed-in user claim an
  // invite addressed to someone else by guessing the URL.
  const inviteEmail = inv.email.toLowerCase();
  const sessionEmail = session.user.email.toLowerCase();
  if (inviteEmail !== sessionEmail) {
    return { ok: false, error: 'email_mismatch' };
  }

  // Atomic-enough: insert membership (no-op if already member), then mark
  // the invite claimed. If the second update races with revocation, the
  // worst case is an extra membership row — acceptable.
  const [existing] = await db
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(
      and(
        eq(workspaceMember.workspaceId, inv.workspaceId),
        eq(workspaceMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(workspaceMember).values({
      workspaceId: inv.workspaceId,
      userId: session.user.id,
      role: inv.role,
    });
  }

  await db
    .update(workspaceInvite)
    .set({ claimedAt: new Date(), claimedByUserId: session.user.id })
    .where(eq(workspaceInvite.id, inv.id));

  const [wsRow] = await db
    .select({ name: workspace.name })
    .from(workspace)
    .where(eq(workspace.id, inv.workspaceId))
    .limit(1);

  log.info('workspace.invite.claimed', {
    workspaceId: inv.workspaceId,
    inviteId: inv.id,
    userId: session.user.id,
  });
  await recordAuditEvent({
    workspaceId: inv.workspaceId,
    actorUserId: session.user.id,
    kind: 'workspace.invite.claimed',
    title: `${session.user.email ?? 'A user'} joined via invite`,
    payload: { inviteId: inv.id, email: inv.email, role: inv.role },
  });

  revalidatePath('/settings/team');
  return {
    ok: true,
    workspaceId: inv.workspaceId,
    workspaceName: wsRow?.name ?? 'workspace',
  };
}

export async function listPendingInvites(workspaceId: string) {
  const db = getDb();
  const now = new Date();
  return db
    .select({
      id: workspaceInvite.id,
      email: workspaceInvite.email,
      role: workspaceInvite.role,
      expiresAt: workspaceInvite.expiresAt,
      createdAt: workspaceInvite.createdAt,
    })
    .from(workspaceInvite)
    .where(
      and(
        eq(workspaceInvite.workspaceId, workspaceId),
        isNull(workspaceInvite.claimedAt),
        isNull(workspaceInvite.revokedAt),
        gt(workspaceInvite.expiresAt, now),
      ),
    );
}

// ---------------------------------------------------------------------------
// Ownership transfer (5B)
// ---------------------------------------------------------------------------

const TransferSchema = z.object({
  targetUserId: z.string().uuid(),
  /**
   * Confirmation: the inviter must type the target's email exactly. The
   * UI prompts for this; sending it back protects against a stale UI
   * showing a stale member list.
   */
  confirmEmail: z.string().min(3),
});

export type TransferResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'unauthenticated'
        | 'forbidden'
        | 'invalid'
        | 'not_member'
        | 'cannot_transfer_to_self'
        | 'email_mismatch';
    };

export async function transferOwnershipAction(
  input: z.input<typeof TransferSchema>,
): Promise<TransferResult> {
  const guard = await requireOwner();
  if (!guard.ok) {
    const e = guard.error === 'unauthenticated' ? 'unauthenticated' : 'forbidden';
    return { ok: false, error: e };
  }
  const parsed = TransferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  if (parsed.data.targetUserId === guard.userId) {
    return { ok: false, error: 'cannot_transfer_to_self' };
  }

  const db = getDb();
  const [target] = await db
    .select({
      userId: workspaceMember.userId,
      role: workspaceMember.role,
      email: user.email,
    })
    .from(workspaceMember)
    .innerJoin(user, eq(user.id, workspaceMember.userId))
    .where(
      and(
        eq(workspaceMember.workspaceId, guard.workspaceId),
        eq(workspaceMember.userId, parsed.data.targetUserId),
      ),
    )
    .limit(1);
  if (!target) return { ok: false, error: 'not_member' };
  if (target.email.toLowerCase() !== parsed.data.confirmEmail.trim().toLowerCase()) {
    return { ok: false, error: 'email_mismatch' };
  }

  // Two updates in a transaction so we never end up with two owners or
  // none. Drizzle 0.36's transaction API accepts an async callback.
  await db.transaction(async (tx) => {
    await tx
      .update(workspaceMember)
      .set({ role: 'owner' })
      .where(
        and(
          eq(workspaceMember.workspaceId, guard.workspaceId),
          eq(workspaceMember.userId, target.userId),
        ),
      );
    await tx
      .update(workspaceMember)
      .set({ role: 'admin' })
      .where(
        and(
          eq(workspaceMember.workspaceId, guard.workspaceId),
          eq(workspaceMember.userId, guard.userId),
        ),
      );
  });

  log.info('workspace.ownership.transferred', {
    workspaceId: guard.workspaceId,
    fromUserId: guard.userId,
    toUserId: target.userId,
  });
  await recordAuditEvent({
    workspaceId: guard.workspaceId,
    actorUserId: guard.userId,
    kind: 'workspace.ownership.transferred',
    title: `Transferred ownership to ${target.email}`,
    payload: { fromUserId: guard.userId, toUserId: target.userId, toEmail: target.email },
  });
  revalidatePath('/settings/team');
  return { ok: true };
}
