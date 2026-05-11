import {
  BarChart3,
  Bell,
  Blocks,
  Bot,
  Brain,
  CalendarDays,
  Compass,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Eye,
  FolderKanban,
  Gauge,
  Inbox,
  Keyboard,
  KeyRound,
  Laptop,
  Layers,
  Library,
  MessageSquare,
  Plug,
  Rocket,
  RotateCcw,
  ScrollText,
  Settings as SettingsIcon,
  Sparkles,
  Target,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavLeaf {
  kind: 'leaf';
  href: string;
  label: string;
  icon: LucideIcon;
  /** When true, only an exact pathname match counts as active. */
  exact?: boolean;
}

export interface NavGroup {
  kind: 'group';
  id: string;
  label: string;
  icon: LucideIcon;
  /** Override for the parent click target (defaults to first child). */
  href?: string;
  children: NavLeaf[];
  /**
   * If true, the child panel is rendered by a custom component rather than the
   * default child-list (e.g. METU pulls conversations from the database).
   */
  dynamic?: boolean;
}

export type NavNode = NavLeaf | NavGroup;

export const NAV: NavNode[] = [
  { kind: 'leaf', href: '/onboarding', label: 'Get started', icon: Rocket },
  { kind: 'leaf', href: '/resume', label: 'Resume', icon: RotateCcw },
  { kind: 'leaf', href: '/dashboard', label: 'Now', icon: Compass },
  { kind: 'leaf', href: '/metu', label: 'METU', icon: Sparkles },
  {
    kind: 'group',
    id: 'chat',
    label: 'Chat',
    icon: MessageSquare,
    href: '/chat',
    dynamic: true,
    children: [],
  },
  { kind: 'leaf', href: '/agents', label: 'Agents', icon: Bot },
  {
    kind: 'group',
    id: 'projects',
    label: 'Projects',
    icon: Layers,
    children: [
      { kind: 'leaf', href: '/projects', label: 'Projects', icon: FolderKanban },
      { kind: 'leaf', href: '/inbox', label: 'Brain dump', icon: Inbox },
      { kind: 'leaf', href: '/goals', label: 'Goals', icon: Target },
    ],
  },
  {
    kind: 'group',
    id: 'knowledge',
    label: 'Knowledge',
    icon: Library,
    children: [
      { kind: 'leaf', href: '/about-me', label: 'About you', icon: Sparkles },
      { kind: 'leaf', href: '/memory', label: 'Memory', icon: Brain },
      { kind: 'leaf', href: '/timeline', label: 'Timeline', icon: BarChart3 },
      { kind: 'leaf', href: '/review', label: 'Review', icon: CalendarDays },
      { kind: 'leaf', href: '/audit', label: 'Audit', icon: ScrollText },
    ],
  },
  {
    kind: 'group',
    id: 'connect',
    label: 'Connect',
    icon: Plug,
    children: [
      { kind: 'leaf', href: '/devices', label: 'Devices', icon: Laptop },
      { kind: 'leaf', href: '/apps', label: 'API apps', icon: Blocks },
      { kind: 'leaf', href: '/integrations', label: 'Integrations', icon: Plug },
    ],
  },
  {
    kind: 'group',
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    href: '/settings/profile',
    children: [
      { kind: 'leaf', href: '/settings/profile', label: 'Profile', icon: User },
      { kind: 'leaf', href: '/settings', label: 'AI providers', icon: Cpu, exact: true },
      { kind: 'leaf', href: '/settings/autonomy', label: 'Autonomy', icon: Gauge },
      { kind: 'leaf', href: '/settings/presence', label: 'Presence', icon: Eye },
      { kind: 'leaf', href: '/settings/notifications', label: 'Notifications', icon: Bell },
      { kind: 'leaf', href: '/settings/team', label: 'Team', icon: Users },
      { kind: 'leaf', href: '/settings/billing', label: 'Billing', icon: CreditCard },
      { kind: 'leaf', href: '/settings/usage', label: 'Usage', icon: DollarSign },
      { kind: 'leaf', href: '/settings/data', label: 'Data', icon: Database },
      { kind: 'leaf', href: '/settings/api-tokens', label: 'API tokens', icon: KeyRound },
      { kind: 'leaf', href: '/help/keyboard', label: 'Shortcuts', icon: Keyboard },
    ],
  },
];

/** Returns true if `pathname` matches the leaf's href (exact or prefix-based). */
export function isLeafActive(pathname: string | null, leafOrHref: NavLeaf | string): boolean {
  if (!pathname) return false;
  const href = typeof leafOrHref === 'string' ? leafOrHref : leafOrHref.href;
  const exact = typeof leafOrHref === 'string' ? false : leafOrHref.exact === true;
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

/** Returns true if any child of the group is active for `pathname`. */
export function isGroupActive(pathname: string | null, group: NavGroup): boolean {
  if (group.href && isLeafActive(pathname, group.href)) return true;
  return group.children.some((c) => isLeafActive(pathname, c));
}

/**
 * Find the active group for the given pathname (the group whose any child matches).
 * Returns null if no group child matches (top-level leaf or unknown URL).
 */
export function findActiveGroup(pathname: string | null): NavGroup | null {
  for (const node of NAV) {
    if (node.kind === 'group' && isGroupActive(pathname, node)) return node;
  }
  return null;
}
