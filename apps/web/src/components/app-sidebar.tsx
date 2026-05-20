'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ChevronRight, ChevronsLeft, ChevronsRight, Plus, X } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { Button, cn } from '@metu/ui';
import { archiveConversationAction, createSideChatAction } from '@/app/actions/conductor';
import { useT } from '@/lib/i18n/provider';
import { NotificationsBell } from './notifications-bell';
import { SidebarAutonomyPausedChip } from './sidebar-autonomy-paused-chip';
import { useSidebar } from './sidebar/sidebar-provider';
import { UserMenu } from './sidebar/user-menu';
import { WorkspaceSwitcher, type WorkspaceOption } from './sidebar/workspace-switcher';
import {
  findActiveGroup,
  isGroupActive,
  isLeafActive,
  NAV,
  type NavGroup,
  type NavLeaf,
} from './sidebar/nav-config';

export interface MetuConversation {
  id: string;
  kind: 'conductor' | 'side' | 'project' | 'tool';
  title: string;
  lastMessageAt: string | null;
  status: 'active' | 'archived' | 'pinned';
}

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null };
  metuConversations: MetuConversation[];
  /**
   * Optional small numeric badges keyed by leaf href (e.g. `/timeline`).
   * Group rows show the sum of their child badges. Falsy or zero values
   * render no badge.
   */
  badges?: Record<string, number>;
  /** All workspaces the signed-in user is a member of. */
  workspaces?: WorkspaceOption[];
  /** Currently-resolved active workspace id (from session). */
  activeWorkspaceId?: string;
  /** When true, the conductor is paused — show a small chip. */
  autonomyPaused?: boolean;
}

export function AppSidebar({
  user,
  metuConversations,
  badges = {},
  workspaces = [],
  activeWorkspaceId,
  autonomyPaused = false,
}: Props) {
  const { collapsed, toggleCollapsed, mobileOpen, setMobileOpen } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();

  /** Which group's child panel is currently shown. `null` = root panel. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  // Auto-show the child panel when the URL enters a group via navigation.
  // Only fires when pathname actually changes; clicking Back keeps the root
  // panel open even though the URL still points inside the group.
  useEffect(() => {
    setOpenGroupId(findActiveGroup(pathname)?.id ?? null);
  }, [pathname]);

  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname, setMobileOpen]);

  const openGroup = openGroupId
    ? (NAV.find((n) => n.kind === 'group' && n.id === openGroupId) as NavGroup | undefined)
    : undefined;

  function enterGroup(group: NavGroup) {
    const target = group.children[0]?.href ?? group.href ?? '/dashboard';
    if (collapsed) {
      // Collapsed: clicking a parent jumps directly to its primary target.
      router.push(target);
      return;
    }
    setOpenGroupId(group.id);
    if (!isGroupActive(pathname, group)) {
      router.push(target);
    }
  }

  function exitGroup() {
    setOpenGroupId(null);
  }

  return (
    <>
      <AnimatePresence>
        {mobileOpen && (
          <motion.button
            type="button"
            aria-label="Close navigation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 240 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className={cn(
          'group/aside fixed inset-y-0 left-0 z-50 flex flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)]',
          'transition-transform duration-200 md:sticky md:top-0 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          'h-screen shrink-0',
        )}
      >
        <SidebarHeader collapsed={collapsed} onCloseMobile={() => setMobileOpen(false)} />

        {/* Edge collapse handle: floats on the right border, level with the logo. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'absolute right-0 top-7 z-10 hidden h-6 w-6 translate-x-1/2 cursor-pointer place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-fg-muted)] shadow-sm transition-all md:grid',
            'opacity-0 hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)] focus-visible:opacity-100 group-hover/aside:opacity-100',
          )}
        >
          {collapsed ? <ChevronsRight className="h-3 w-3" /> : <ChevronsLeft className="h-3 w-3" />}
        </button>

        <div className="relative flex-1 overflow-hidden">
          <AnimatePresence initial={false}>
            {!openGroup || collapsed ? (
              <NavPanel
                key="root"
                direction="root"
                pathname={pathname}
                collapsed={collapsed}
                onEnterGroup={enterGroup}
                badges={badges}
              />
            ) : openGroup.id === 'chat' ? (
              <MetuChildPanel
                key="group:chat"
                group={openGroup}
                pathname={pathname}
                conversations={metuConversations}
                onBack={exitGroup}
              />
            ) : (
              <ChildPanel
                key={`group:${openGroup.id}`}
                group={openGroup}
                pathname={pathname}
                onBack={exitGroup}
                badges={badges}
              />
            )}
          </AnimatePresence>
        </div>

        <div className="mt-auto border-t border-[var(--color-border)] p-2">
          {autonomyPaused ? <SidebarAutonomyPausedChip collapsed={collapsed} /> : null}
          {workspaces.length > 1 && activeWorkspaceId ? (
            <div className="mb-2">
              <WorkspaceSwitcher
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspaceId}
                collapsed={collapsed}
              />
            </div>
          ) : null}
          <NotificationsBell />
          <UserMenu user={user} collapsed={collapsed} />
        </div>
      </motion.aside>
    </>
  );
}

function SidebarHeader({
  collapsed,
  onCloseMobile,
}: {
  collapsed: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 px-3">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-2 font-semibold">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--color-brand)] text-xs text-[var(--color-brand-fg)]">
          m
        </span>
        {!collapsed && <span className="truncate">metu</span>}
      </Link>
      <button
        type="button"
        onClick={onCloseMobile}
        aria-label="Close navigation"
        className="ml-auto grid h-8 w-8 cursor-pointer place-items-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)] md:hidden"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const PANEL_TRANSITION = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

function NavPanel({
  pathname,
  collapsed,
  onEnterGroup,
  badges,
}: {
  direction: 'root';
  pathname: string | null;
  collapsed: boolean;
  onEnterGroup: (g: NavGroup) => void;
  badges: Record<string, number>;
}) {
  return (
    <motion.nav
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, pointerEvents: 'none' }}
      transition={PANEL_TRANSITION}
      className="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto px-2 pb-2"
    >
      {NAV.map((node) =>
        node.kind === 'leaf' ? (
          <LeafItem
            key={node.href}
            leaf={node}
            pathname={pathname}
            collapsed={collapsed}
            badge={badges[node.href]}
          />
        ) : (
          <GroupRow
            key={node.id}
            group={node}
            pathname={pathname}
            collapsed={collapsed}
            onClick={() => onEnterGroup(node)}
            badge={node.children.reduce((sum, c) => sum + (badges[c.href] ?? 0), 0)}
          />
        ),
      )}
    </motion.nav>
  );
}

function ChildPanel({
  group,
  pathname,
  onBack,
  badges,
}: {
  group: NavGroup;
  pathname: string | null;
  onBack: () => void;
  badges: Record<string, number>;
}) {
  const Icon = group.icon;
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, pointerEvents: 'none' }}
      transition={PANEL_TRANSITION}
      className="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto px-2 pb-2"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs uppercase tracking-wide text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--color-border)] px-2.5 pb-2 pt-1 text-[var(--color-fg-muted)]">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
          {group.label}
        </span>
      </div>
      {group.children.map((child) => (
        <LeafItem
          key={child.href}
          leaf={child}
          pathname={pathname}
          collapsed={false}
          badge={badges[child.href]}
        />
      ))}
    </motion.div>
  );
}

function LeafItem({
  leaf,
  pathname,
  collapsed,
  badge,
}: {
  leaf: NavLeaf;
  pathname: string | null;
  collapsed: boolean;
  badge?: number;
}) {
  const active = isLeafActive(pathname, leaf);
  const Icon = leaf.icon;
  const t = useT('nav');
  const label = leaf.i18nKey ? (t(leaf.i18nKey as never) as string) : leaf.label;
  const showBadge = typeof badge === 'number' && badge > 0;
  return (
    <Link
      href={leaf.href}
      title={collapsed ? `${label}${showBadge ? ` (${badge})` : ''}` : undefined}
      className={cn(
        'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
        active
          ? 'text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 -z-10 rounded-md bg-[var(--color-bg-card)]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
      {showBadge && !collapsed && <NavBadge count={badge} />}
      {showBadge && collapsed && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]"
        />
      )}
    </Link>
  );
}

function NavBadge({ count }: { count: number }) {
  const display = count > 99 ? '99+' : String(count);
  return (
    <span className="ml-auto rounded-full bg-[var(--color-bg-card)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--color-fg-muted)]">
      {display}
    </span>
  );
}

function GroupRow({
  group,
  pathname,
  collapsed,
  onClick,
  badge,
}: {
  group: NavGroup;
  pathname: string | null;
  collapsed: boolean;
  onClick: () => void;
  badge: number;
}) {
  const groupActive = isGroupActive(pathname, group);
  const Icon = group.icon;
  const t = useT('nav');
  const label = group.i18nKey ? (t(group.i18nKey as never) as string) : group.label;
  const showBadge = badge > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? `${label}${showBadge ? ` (${badge})` : ''}` : undefined}
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
        groupActive
          ? 'text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {groupActive && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 -z-10 rounded-md bg-[var(--color-bg-card)]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          {showBadge && <NavBadge count={badge} />}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-fg-subtle)]" />
        </>
      )}
      {showBadge && collapsed && (
        <span
          aria-hidden
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-brand)]"
        />
      )}
    </button>
  );
}

function MetuChildPanel({
  group,
  pathname,
  conversations,
  onBack,
}: {
  group: NavGroup;
  pathname: string | null;
  conversations: MetuConversation[];
  onBack: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const Icon = group.icon;

  const onChat = !!pathname && (pathname === '/chat' || pathname.startsWith('/chat/'));
  const activeId = onChat ? searchParams.get('id') : null;

  const conductor = conversations.find((c) => c.kind === 'conductor');
  const sides = conversations.filter((c) => c.kind !== 'conductor');
  const effectiveActiveId = activeId ?? (onChat ? (conductor?.id ?? null) : null);

  function selectConvo(id: string) {
    const sp = new URLSearchParams(searchParams);
    sp.set('id', id);
    router.push(`/chat?${sp.toString()}`);
  }

  function newChat() {
    startTransition(async () => {
      const r = await createSideChatAction({});
      if (r.ok && r.id) selectConvo(r.id);
    });
  }

  function archive(id: string) {
    startTransition(async () => {
      await archiveConversationAction(id);
      if (id === effectiveActiveId && conductor) selectConvo(conductor.id);
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, pointerEvents: 'none' }}
      transition={PANEL_TRANSITION}
      className="absolute inset-0 flex flex-col gap-0.5 overflow-y-auto px-2 pb-2"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-xs uppercase tracking-wide text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>
      <div className="mb-2 flex items-center gap-2 border-b border-[var(--color-border)] px-2.5 pb-2 pt-1 text-[var(--color-fg-muted)]">
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em]">
          {group.label}
        </span>
      </div>

      <Button size="sm" onClick={newChat} disabled={pending} className="mb-2">
        <Plus className="h-4 w-4" />
        New conversation
      </Button>

      {conductor && (
        <ConvoButton
          item={conductor}
          active={conductor.id === effectiveActiveId}
          onClick={() => selectConvo(conductor.id)}
        />
      )}

      <div className="mt-3 px-2.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-fg-subtle)]">
        Side chats
      </div>
      <ol className="flex flex-col gap-0.5">
        {sides.length === 0 && (
          <li className="px-2.5 py-1 text-xs text-[var(--color-fg-subtle)]">No side chats.</li>
        )}
        {sides.map((c) => (
          <ConvoButton
            key={c.id}
            item={c}
            active={c.id === effectiveActiveId}
            onClick={() => selectConvo(c.id)}
            onArchive={() => archive(c.id)}
          />
        ))}
      </ol>
    </motion.div>
  );
}

function ConvoButton({
  item,
  active,
  onClick,
  onArchive,
}: {
  item: MetuConversation;
  active: boolean;
  onClick: () => void;
  onArchive?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
        active
          ? 'text-[var(--color-fg)]'
          : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 -z-10 rounded-md bg-[var(--color-bg-card)]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <span className="flex-1 truncate">{item.title}</span>
      {onArchive && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onArchive();
          }}
          className="text-[10px] text-[var(--color-fg-subtle)] opacity-0 transition-opacity hover:text-[var(--color-fg)] group-hover:opacity-100"
          aria-label="archive"
        >
          ✕
        </span>
      )}
    </button>
  );
}
