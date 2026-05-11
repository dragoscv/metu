'use client';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  Blocks,
  Bot,
  Brain,
  CalendarDays,
  Compass,
  FolderKanban,
  Inbox,
  Keyboard,
  Laptop,
  MessageSquare,
  Palette,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { THEMES, useTheme } from './theme-provider';

const NAV_ITEMS = [
  { label: 'Now (focus)', href: '/dashboard', icon: Compass },
  { label: 'METU (agent dashboard)', href: '/metu', icon: Sparkles },
  { label: 'Chat', href: '/chat', icon: MessageSquare },
  { label: 'Agents', href: '/agents', icon: Bot },
  { label: 'Brain dump', href: '/inbox', icon: Inbox },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Goals & targets', href: '/goals', icon: Target },
  { label: 'About you (profile wizard)', href: '/about-me', icon: Sparkles },
  { label: 'Memory', href: '/memory', icon: Brain },
  { label: 'Timeline', href: '/timeline', icon: BarChart3 },
  { label: 'Review (last 7 days)', href: '/review', icon: CalendarDays },
  { label: 'Devices', href: '/devices', icon: Laptop },
  { label: 'API apps', href: '/apps', icon: Blocks },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Autonomy', href: '/settings/autonomy', icon: ShieldCheck },
  { label: 'Settings', href: '/settings', icon: Settings },
  { label: 'Keyboard shortcuts', href: '/help/keyboard', icon: Keyboard },
];

const ACTIONS = [{ label: 'Recompute focus', href: '/dashboard?recompute=1', icon: Sparkles }];

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/60 px-4 pt-32 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="Command palette">
              <Command.Input
                placeholder="Type a command or search..."
                className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
                autoFocus
              />
              <Command.List className="max-h-96 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]">
                  No results.
                </Command.Empty>
                <Command.Group heading="Navigate">
                  {NAV_ITEMS.map((item) => (
                    <Command.Item
                      key={item.href}
                      value={`nav ${item.label}`}
                      onSelect={() => {
                        router.push(item.href);
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                    >
                      <item.icon className="h-4 w-4 text-[var(--color-fg-muted)]" />
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Actions">
                  {ACTIONS.map((a) => (
                    <Command.Item
                      key={a.href}
                      value={`action ${a.label}`}
                      onSelect={() => {
                        router.push(a.href);
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                    >
                      <a.icon className="h-4 w-4 text-[var(--color-fg-muted)]" />
                      {a.label}
                    </Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Theme">
                  {THEMES.map((t) => (
                    <Command.Item
                      key={t.name}
                      value={`theme ${t.label}`}
                      onSelect={() => {
                        setTheme(t.name);
                        setOpen(false);
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                    >
                      <Palette className="h-4 w-4 text-[var(--color-fg-muted)]" />
                      Switch to {t.label}
                      <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">
                        {t.hint}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
