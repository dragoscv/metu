'use client';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Brain, Compass, FolderKanban, Inbox, Plug, Sparkles } from 'lucide-react';

const ITEMS = [
  { label: 'Open Now (focus)', href: '/dashboard', icon: Compass },
  { label: 'Brain dump', href: '/inbox', icon: Inbox },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Memory recall', href: '/memory', icon: Brain },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Recompute focus', href: '/dashboard?recompute=1', icon: Sparkles },
];

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
            transition={{ duration: 0.2 }}
            className="w-full max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Command label="Command palette">
              <Command.Input
                placeholder="Type a command or search..."
                className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
                autoFocus
              />
              <Command.List className="max-h-80 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]">
                  No results.
                </Command.Empty>
                {ITEMS.map((item) => (
                  <Command.Item
                    key={item.href}
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
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
