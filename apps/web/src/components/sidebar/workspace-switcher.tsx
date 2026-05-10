'use client';
/**
 * Compact workspace switcher for users who belong to multiple workspaces.
 *
 * Renders a dropdown showing all of the user's memberships. Selecting
 * one calls `switchWorkspaceAction`, which sets the
 * `metu.workspace` cookie and revalidates the layout. The Auth.js
 * session callback then resolves the new workspace on the next render.
 *
 * If the user only has one workspace this component renders nothing —
 * no point in adding chrome the user can't act on.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { switchWorkspaceAction } from '@/app/actions/workspace-switch';

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  collapsed,
}: {
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (workspaces.length <= 1) return null;

  const active = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0]!;

  const handlePick = (ws: WorkspaceOption) => {
    if (ws.id === activeWorkspaceId) {
      setOpen(false);
      return;
    }
    start(async () => {
      const r = await switchWorkspaceAction({ workspaceId: ws.id });
      if (r.ok) {
        toast.success(`Switched to ${ws.name}`);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(humanize(r.error));
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? active.name : undefined}
        aria-label={`Active workspace: ${active.name}. Click to switch.`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs text-[var(--color-fg-muted)] hover:border-[var(--color-border)] hover:bg-[var(--color-bg-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
      >
        <span className="bg-[var(--color-brand)]/15 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold uppercase text-[var(--color-brand)]">
          {active.name.slice(0, 1)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-[var(--color-fg)]">
              {active.name}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </>
        )}
      </button>

      {open && !collapsed ? (
        <ul
          role="listbox"
          aria-label="Workspaces"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-card)] py-1 text-xs shadow-lg"
        >
          {workspaces.map((ws) => {
            const isActive = ws.id === activeWorkspaceId;
            return (
              <li key={ws.id} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => handlePick(ws)}
                  disabled={pending}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-[var(--color-bg-elevated)] disabled:opacity-50"
                >
                  <span className="bg-[var(--color-brand)]/10 grid h-5 w-5 shrink-0 place-items-center rounded-[4px] text-[10px] font-semibold uppercase text-[var(--color-brand)]">
                    {ws.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                  {isActive ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-brand)]" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function humanize(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Sign in to switch workspaces.';
    case 'invalid_input':
      return 'Invalid workspace.';
    case 'not_member':
      return 'You no longer have access to that workspace.';
    default:
      return 'Switch failed.';
  }
}
