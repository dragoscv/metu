'use client';
/**
 * Team management UI — owner-only. List, add, change role, remove.
 *
 * Optimistic UX is intentionally absent: every action revalidates the
 * server route to guarantee the rendered roles match the DB. Membership
 * changes are infrequent; latency over correctness is the wrong trade.
 */
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardTitle, Dialog, DialogFooter } from '@metu/ui';
import {
  addMemberAction,
  changeMemberRoleAction,
  inviteByEmailAction,
  removeMemberAction,
  revokeInviteAction,
  transferOwnershipAction,
} from '@/app/actions/team';

export type TeamMember = {
  userId: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member';
  joinedAt: string;
  isSelf: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
};

const ROLE_LABEL: Record<TeamMember['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

export function TeamManager({
  members,
  invites = [],
}: {
  members: TeamMember[];
  invites?: PendingInvite[];
}) {
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<TeamMember | null>(null);
  const [transferConfirm, setTransferConfirm] = useState('');

  const handleAdd = () => {
    if (!email.trim()) return;
    const target = email.trim();
    start(async () => {
      const r = await addMemberAction({ email: target, role });
      if (r.ok) {
        toast.success(`Added ${target}`);
        setEmail('');
        return;
      }
      // Fall through to invite-by-email when the email doesn't match an
      // existing user. The owner intent is the same in both cases —
      // "give this person access" — so we don't make them click again.
      if (r.error === 'user_not_found_invite_required') {
        const inv = await inviteByEmailAction({ email: target, role });
        if (inv.ok) {
          if (inv.emailStatus === 'sent') {
            toast.success(`Invite emailed to ${target}`);
          } else if (inv.emailStatus === 'logged') {
            toast.message(`Invite created (no email key — link in server log)`, {
              description: inv.inviteUrl ?? undefined,
            });
          } else {
            toast.warning(`Invite saved but email failed for ${target}`);
          }
          setEmail('');
        } else {
          toast.error(humanizeError(inv.error));
        }
        return;
      }
      toast.error(humanizeError(r.error));
    });
  };

  const handleRoleChange = (m: TeamMember, next: TeamMember['role']) => {
    if (next === m.role) return;
    start(async () => {
      const r = await changeMemberRoleAction({
        targetUserId: m.userId,
        role: next,
      });
      if (r.ok) toast.success(`${m.email} is now ${ROLE_LABEL[next]}`);
      else toast.error(humanizeError(r.error));
    });
  };

  const confirmRemove = () => {
    const m = removeTarget;
    if (!m) return;
    start(async () => {
      const r = await removeMemberAction({ targetUserId: m.userId });
      if (r.ok) toast.success(`Removed ${m.email}`);
      else toast.error(humanizeError(r.error));
      setRemoveTarget(null);
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Add member</CardTitle>
        <p className="mt-2 text-xs text-[var(--color-fg-subtle)]">
          If they already have a metu account, they're added immediately. Otherwise we email them a
          single-use invite link valid for 7 days.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-1 flex-col gap-1 text-xs">
            <span className="text-[var(--color-fg-subtle)]">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-[var(--color-fg-subtle)]">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <Button onClick={handleAdd} disabled={pending || !email.trim()}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Members ({members.length})</CardTitle>
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[var(--color-fg)]">
                  {m.name ?? m.email}
                  {m.isSelf ? (
                    <span className="ml-2 text-xs text-[var(--color-fg-subtle)]">(you)</span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-[var(--color-fg-subtle)]">
                  {m.email} · joined {new Date(m.joinedAt).toLocaleDateString()}
                </div>
              </div>

              <select
                value={m.role}
                onChange={(e) => handleRoleChange(m, e.target.value as TeamMember['role'])}
                disabled={pending || m.isSelf}
                className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs disabled:opacity-50"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>

              <button
                type="button"
                onClick={() => setRemoveTarget(m)}
                disabled={pending || m.isSelf || m.role === 'owner'}
                className="rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-30"
              >
                Remove
              </button>

              <button
                type="button"
                onClick={() => {
                  setTransferTarget(m);
                  setTransferConfirm('');
                }}
                disabled={pending || m.isSelf || m.role === 'owner'}
                title={
                  m.isSelf
                    ? "You can't transfer to yourself."
                    : m.role === 'owner'
                      ? 'Already owner.'
                      : 'Hand the workspace owner role to this member.'
                }
                className="rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-30"
              >
                Transfer…
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {invites.length > 0 ? (
        <Card>
          <CardTitle>Pending invites ({invites.length})</CardTitle>
          <ul className="mt-3 divide-y divide-[var(--color-border)]">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-[var(--color-fg)]">{i.email}</div>
                  <div className="truncate text-xs text-[var(--color-fg-subtle)]">
                    {ROLE_LABEL[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    start(async () => {
                      const r = await revokeInviteAction({ inviteId: i.id });
                      if (r.ok) toast.success('Invite revoked');
                      else toast.error(humanizeError(r.error));
                    })
                  }
                  disabled={pending}
                  className="rounded-[var(--radius)] px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] disabled:opacity-30"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        title="Remove member?"
        description={
          removeTarget ? `${removeTarget.email} will lose access to this workspace.` : undefined
        }
      >
        <p className="text-[var(--color-fg-muted)]">
          They keep their account and any personal data, but cannot view or act on workspace content
          until re-added.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setRemoveTarget(null)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmRemove} disabled={pending}>
            {pending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={transferTarget !== null}
        onClose={() => setTransferTarget(null)}
        title="Transfer workspace ownership?"
        description={
          transferTarget
            ? `${transferTarget.email} will become the new owner. You will be demoted to admin.`
            : undefined
        }
      >
        <div className="space-y-3 text-[var(--color-fg-muted)]">
          <p>
            Ownership controls billing, member management, and workspace deletion. This is
            reversible only if the new owner transfers it back.
          </p>
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-subtle)]">
            <span>
              Type{' '}
              <strong className="font-mono text-[var(--color-fg)]">{transferTarget?.email}</strong>{' '}
              to confirm.
            </span>
            <input
              type="text"
              value={transferConfirm}
              onChange={(e) => setTransferConfirm(e.target.value)}
              autoComplete="off"
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 font-mono text-sm text-[var(--color-fg)]"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setTransferTarget(null)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={
              pending ||
              !transferTarget ||
              transferConfirm.trim().toLowerCase() !== transferTarget.email.toLowerCase()
            }
            onClick={() => {
              const t = transferTarget;
              if (!t) return;
              start(async () => {
                const r = await transferOwnershipAction({
                  targetUserId: t.userId,
                  confirmEmail: transferConfirm.trim(),
                });
                if (r.ok) {
                  toast.success(`${t.email} is now the owner`);
                  setTransferTarget(null);
                  setTransferConfirm('');
                } else {
                  toast.error(humanizeError(r.error));
                }
              });
            }}
          >
            {pending ? 'Transferring…' : 'Transfer ownership'}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}

function humanizeError(code: string): string {
  switch (code) {
    case 'user_not_found_invite_required':
      return 'No metu account exists for that email yet.';
    case 'already_member':
      return 'That user is already in the workspace.';
    case 'cannot_demote_self':
      return 'Transfer ownership before demoting yourself.';
    case 'cannot_remove_self':
      return "You can't remove yourself.";
    case 'cannot_remove_last_owner':
      return 'Workspace must have at least one owner.';
    case 'cannot_add_as_owner':
      return 'Use ownership transfer to grant the owner role.';
    case 'forbidden':
      return 'Owner role required.';
    case 'not_found':
      return 'Already revoked or claimed.';
    case 'invalid':
      return 'Invalid input.';
    case 'cannot_transfer_to_self':
      return "You can't transfer ownership to yourself.";
    case 'not_member':
      return 'That user is not a member of this workspace.';
    case 'email_mismatch':
      return 'Email confirmation does not match.';
    case 'unauthenticated':
      return 'Sign in again to continue.';
    default:
      return code.replace(/_/g, ' ');
  }
}
