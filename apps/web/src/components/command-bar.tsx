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
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { THEMES, useTheme } from './theme-provider';
import { parseSlash } from '@/lib/slash';

/**
 * Slash commands. Typed at the start of the input, they collapse the
 * palette into a single dynamic action against the rest of the query.
 *   /recall <query>  → navigate to /memory?q=...
 *   /capture <text>  → open QuickCapture pre-filled
 *   /focus           → recompute focus
 *   /chat <prompt>   → send prompt to Conductor thread
 *   /go <route>      → navigate to a route
 */
const SLASH_HELP: { cmd: string; hint: string; icon: typeof Search }[] = [
  { cmd: '/recall', hint: 'search memory', icon: Search },
  { cmd: '/capture', hint: 'fast capture', icon: Inbox },
  { cmd: '/focus', hint: 'recompute focus', icon: Sparkles },
  { cmd: '/chat', hint: 'send to Conductor', icon: MessageSquare },
  { cmd: '/tool', hint: 'pick an agent tool', icon: Bot },
  { cmd: '/go', hint: 'navigate', icon: Zap },
];

const NAV_ITEMS = [
  { label: 'Now (focus)', href: '/dashboard', icon: Compass },
  { label: 'Customize dashboard', href: '/settings/dashboard', icon: Palette },
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
  const [value, setValue] = useState('');
  const [tools, setTools] = useState<{ name: string; description: string; kind: string }[]>([]);
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

  // Reset query whenever we close so the next open is a clean slate.
  useEffect(() => {
    if (!open) setValue('');
  }, [open]);

  const trimmed = value.trim();
  const slash = parseSlash(trimmed);

  // Lazy-load the tool catalog the first time the user opens /tool. Cheap
  // GET; cached in component state for the lifetime of the page.
  useEffect(() => {
    if (slash?.cmd === '/tool' && tools.length === 0) {
      void fetch('/api/tools/list')
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { tools?: typeof tools } | null) => {
          if (j?.tools) setTools(j.tools);
        })
        .catch(() => undefined);
    }
  }, [slash?.cmd, tools.length]);

  function close() {
    setOpen(false);
  }

  function runSlash() {
    if (!slash) return;
    switch (slash.cmd) {
      case '/recall':
        router.push(`/memory?q=${encodeURIComponent(slash.arg)}`);
        close();
        return;
      case '/capture':
        // Hand off to QuickCapture via a custom event; if no text was given
        // it just opens the modal empty.
        window.dispatchEvent(
          new CustomEvent('metu:quick-capture', { detail: { text: slash.arg } }),
        );
        close();
        return;
      case '/focus':
        router.push('/dashboard?recompute=1');
        close();
        return;
      case '/chat':
        router.push(`/chat?q=${encodeURIComponent(slash.arg)}`);
        close();
        return;
      case '/tool': {
        // If an exact name was typed, fire the global event so any open
        // surface can react. Otherwise the picker UI handles selection.
        const name = slash.arg.trim();
        if (name && tools.some((t) => t.name === name)) {
          window.dispatchEvent(new CustomEvent('metu:run-tool', { detail: { name } }));
          router.push(`/agents?tool=${encodeURIComponent(name)}`);
          close();
        }
        return;
      }
      case '/go':
        router.push(slash.arg.startsWith('/') ? slash.arg : `/${slash.arg}`);
        close();
        return;
      default:
        // Unknown slash — fall through to normal palette behaviour.
        return;
    }
  }

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
            <Command label="Command palette" shouldFilter={!slash}>
              <Command.Input
                placeholder="Type a command, search, or /recall, /capture, /focus, /chat, /go…"
                value={value}
                onValueChange={setValue}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && slash) {
                    e.preventDefault();
                    runSlash();
                  }
                }}
                className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
                autoFocus
              />
              <Command.List className="max-h-96 overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-sm text-[var(--color-fg-subtle)]">
                  No results.
                </Command.Empty>

                {slash ? (
                  <Command.Group heading="Slash command">
                    <Command.Item
                      value={`slash ${slash.cmd}`}
                      onSelect={runSlash}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                    >
                      <Send className="h-4 w-4 text-[var(--color-brand)]" />
                      <span className="font-mono text-[var(--color-brand)]">{slash.cmd}</span>
                      {slash.arg && <span className="text-[var(--color-fg)]">{slash.arg}</span>}
                      <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">
                        ↵ run
                      </span>
                    </Command.Item>
                    {slash.cmd === '/tool' &&
                      tools
                        .filter(
                          (t) =>
                            !slash.arg ||
                            t.name.toLowerCase().includes(slash.arg.toLowerCase()) ||
                            t.description.toLowerCase().includes(slash.arg.toLowerCase()),
                        )
                        .slice(0, 12)
                        .map((t) => (
                          <Command.Item
                            key={t.name}
                            value={`tool ${t.name} ${t.description}`}
                            onSelect={() => {
                              window.dispatchEvent(
                                new CustomEvent('metu:run-tool', { detail: { name: t.name } }),
                              );
                              router.push(`/agents?tool=${encodeURIComponent(t.name)}`);
                              close();
                            }}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                          >
                            <Bot className="h-4 w-4 text-[var(--color-fg-muted)]" />
                            <span className="font-mono text-[var(--color-fg)]">{t.name}</span>
                            <span className="ml-auto truncate text-[10px] text-[var(--color-fg-subtle)]">
                              {t.kind}
                            </span>
                          </Command.Item>
                        ))}
                    {SLASH_HELP.map((s) => (
                      <Command.Item
                        key={s.cmd}
                        value={`slash-help ${s.cmd}`}
                        onSelect={() => setValue(s.cmd + ' ')}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-xs text-[var(--color-fg-muted)] aria-selected:bg-[var(--color-bg-elevated)]"
                      >
                        <s.icon className="h-3.5 w-3.5" />
                        <span className="font-mono">{s.cmd}</span>
                        <span>— {s.hint}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                ) : (
                  <>
                    <Command.Group heading="Navigate">
                      {NAV_ITEMS.map((item) => (
                        <Command.Item
                          key={item.href}
                          value={`nav ${item.label}`}
                          onSelect={() => {
                            router.push(item.href);
                            close();
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
                            close();
                          }}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                        >
                          <a.icon className="h-4 w-4 text-[var(--color-fg-muted)]" />
                          {a.label}
                        </Command.Item>
                      ))}
                    </Command.Group>
                    <Command.Group heading="Slash commands">
                      {SLASH_HELP.map((s) => (
                        <Command.Item
                          key={s.cmd}
                          value={`slash-hint ${s.cmd} ${s.hint}`}
                          onSelect={() => setValue(s.cmd + ' ')}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm aria-selected:bg-[var(--color-bg-elevated)]"
                        >
                          <s.icon className="h-4 w-4 text-[var(--color-fg-muted)]" />
                          <span className="font-mono text-[var(--color-fg)]">{s.cmd}</span>
                          <span className="text-[var(--color-fg-subtle)]">— {s.hint}</span>
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
                            close();
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
                  </>
                )}
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
