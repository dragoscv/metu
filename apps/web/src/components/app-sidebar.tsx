'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  BarChart3,
  Blocks,
  Brain,
  Compass,
  FolderKanban,
  Inbox,
  Laptop,
  MessageSquare,
  Plug,
  Settings,
  Sparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@metu/ui';

const NAV = [
  { href: '/dashboard', label: 'Now', icon: Compass },
  { href: '/conductor', label: 'Conductor', icon: MessageSquare },
  { href: '/inbox', label: 'Brain dump', icon: Inbox },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/timeline', label: 'Timeline', icon: BarChart3 },
  { href: '/devices', label: 'Devices', icon: Laptop },
  { href: '/apps', label: 'Apps', icon: Blocks },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar({
  user,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null };
}) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-5">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2 px-2 font-semibold">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-brand)] text-xs text-[var(--color-brand-fg)]">
          m
        </span>
        metu
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'text-[var(--color-fg)]'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 -z-10 rounded-md bg-[var(--color-bg-card)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="mt-2 flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-[var(--color-bg-card)]"
        onClick={() => signOut({ callbackUrl: '/' })}
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--color-bg-card)]">
            <Sparkles className="h-3 w-3" />
          </span>
        )}
        <span className="flex-1 truncate text-left">{user.name ?? user.email}</span>
      </button>
    </aside>
  );
}
