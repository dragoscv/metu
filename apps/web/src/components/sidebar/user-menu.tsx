'use client';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Gauge,
  LogOut,
  Monitor,
  Palette,
  Settings,
  Sparkles,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { THEMES, useTheme, type ThemeName } from '../theme-provider';

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null };
  collapsed: boolean;
}

type View = 'root' | 'theme';

const PANEL_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

export function UserMenu({ user, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('root');
  const ref = useRef<HTMLDivElement>(null);
  const { theme, isSystem, setTheme, resetToSystem } = useTheme();

  // Reset to root view on close.
  useEffect(() => {
    if (!open) setView('root');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const themeLabel = isSystem ? 'System' : (THEMES.find((t) => t.name === theme)?.label ?? 'Theme');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? (user.name ?? user.email ?? 'Account') : undefined}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--color-fg)] hover:bg-[var(--color-bg-card)]"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-7 w-7 shrink-0 rounded-full" />
        ) : (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-bg-card)] text-[var(--color-fg-muted)]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        )}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{user.name ?? user.email}</span>
            <ChevronUp
              className={`h-3.5 w-3.5 shrink-0 text-[var(--color-fg-muted)] transition-transform ${
                open ? '' : 'rotate-180'
              }`}
            />
          </>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={PANEL_TRANSITION}
            className="absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-2xl"
          >
            <AnimatePresence mode="wait" initial={false}>
              {view === 'root' ? (
                <RootMenu
                  key="root"
                  user={user}
                  themeLabel={themeLabel}
                  onClose={() => setOpen(false)}
                  onOpenTheme={() => setView('theme')}
                />
              ) : (
                <ThemeMenu
                  key="theme"
                  isSystem={isSystem}
                  theme={theme}
                  setTheme={setTheme}
                  resetToSystem={resetToSystem}
                  onBack={() => setView('root')}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RootMenu({
  user,
  themeLabel,
  onClose,
  onOpenTheme,
}: {
  user: Props['user'];
  themeLabel: string;
  onClose: () => void;
  onOpenTheme: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={PANEL_TRANSITION}
      className="p-1"
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <p className="truncate text-sm font-medium">{user.name ?? 'Account'}</p>
        {user.email && (
          <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{user.email}</p>
        )}
      </div>
      <div className="py-1">
        <MenuLink href="/settings/profile" icon={User} label="Profile" onClick={onClose} />
        <MenuLink href="/settings" icon={Settings} label="Settings" onClick={onClose} />
        <MenuLink href="/settings/autonomy" icon={Gauge} label="Autonomy" onClick={onClose} />
        <MenuLink href="/settings/billing" icon={CreditCard} label="Billing" onClick={onClose} />
        <button
          type="button"
          onClick={onOpenTheme}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
        >
          <Palette className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Theme</span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">{themeLabel}</span>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
        </button>
      </div>
      <div className="border-t border-[var(--color-border)] p-1">
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[var(--color-danger)] hover:bg-[var(--color-danger-bg)]"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Sign out</span>
        </button>
      </div>
    </motion.div>
  );
}

function ThemeMenu({
  isSystem,
  theme,
  setTheme,
  resetToSystem,
  onBack,
}: {
  isSystem: boolean;
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  resetToSystem: () => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={PANEL_TRANSITION}
      className="p-1"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs uppercase tracking-wide text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Theme
      </button>
      <div className="border-t border-[var(--color-border)] py-1">
        <ThemeRow
          active={isSystem}
          onClick={resetToSystem}
          icon={<Monitor className="h-3.5 w-3.5" />}
          label="System"
          hint="Match OS"
        />
        {THEMES.map((t) => (
          <ThemeRow
            key={t.name}
            active={!isSystem && theme === t.name}
            onClick={() => setTheme(t.name)}
            icon={
              <span data-theme={t.name} className="grid h-3.5 w-3.5 place-items-center">
                <span className="block h-3.5 w-3.5 rounded-full border border-[var(--color-border)] bg-[var(--color-brand)]" />
              </span>
            }
            label={t.label}
            hint={t.hint}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ThemeRow({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-bg-elevated)] ${
        active ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]'
      }`}
    >
      {icon}
      <span className="flex-1 text-left">
        <span className="block">{label}</span>
        <span className="block text-[10px] text-[var(--color-fg-subtle)]">{hint}</span>
      </span>
      {active && <Check className="h-3.5 w-3.5 text-[var(--color-brand)]" />}
    </button>
  );
}

function MenuLink({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </Link>
  );
}
