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
  Globe,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sparkles,
  Sun,
  User,
} from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { THEMES, useTheme, type ThemeName } from '../theme-provider';
import { useT, useLocale } from '@/lib/i18n/provider';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/lib/i18n/locale';
import { setLocaleAction } from '@/lib/i18n/actions';

interface Props {
  user: { name?: string | null; email?: string | null; image?: string | null };
  collapsed: boolean;
}

type View = 'root' | 'theme' | 'language';

const PANEL_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

export function UserMenu({ user, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('root');
  const ref = useRef<HTMLDivElement>(null);
  const { theme, isSystem, setTheme, resetToSystem } = useTheme();
  const t = useT('userMenu');
  const locale = useLocale();

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

  const themeLabel = isSystem
    ? (t('system') as string)
    : (THEMES.find((th) => th.name === theme)?.label ?? (t('theme') as string));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? (user.name ?? user.email ?? (t('account') as string)) : undefined}
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
              {view === 'root' && (
                <RootMenu
                  key="root"
                  user={user}
                  themeLabel={themeLabel}
                  localeLabel={LOCALE_LABELS[locale].label}
                  isSystem={isSystem}
                  theme={theme}
                  setTheme={setTheme}
                  resetToSystem={resetToSystem}
                  t={t}
                  onClose={() => setOpen(false)}
                  onOpenTheme={() => setView('theme')}
                  onOpenLanguage={() => setView('language')}
                />
              )}
              {view === 'theme' && (
                <ThemeMenu
                  key="theme"
                  isSystem={isSystem}
                  theme={theme}
                  setTheme={setTheme}
                  resetToSystem={resetToSystem}
                  t={t}
                  onBack={() => setView('root')}
                />
              )}
              {view === 'language' && (
                <LanguageMenu
                  key="language"
                  current={locale}
                  t={t}
                  onBack={() => setView('root')}
                  onChosen={() => setOpen(false)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type T = ReturnType<typeof useT<'userMenu'>>;

function RootMenu({
  user,
  themeLabel,
  localeLabel,
  isSystem,
  theme,
  setTheme,
  resetToSystem,
  t,
  onClose,
  onOpenTheme,
  onOpenLanguage,
}: {
  user: Props['user'];
  themeLabel: string;
  localeLabel: string;
  isSystem: boolean;
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  resetToSystem: () => void;
  t: T;
  onClose: () => void;
  onOpenTheme: () => void;
  onOpenLanguage: () => void;
}) {
  // Quick mode toggle: 'soft' = light, 'minimal' = dark, system = follow OS.
  const mode: 'light' | 'dark' | 'system' = isSystem
    ? 'system'
    : theme === 'soft'
      ? 'light'
      : 'dark';
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={PANEL_TRANSITION}
      className="p-1"
    >
      <div className="border-b border-[var(--color-border)] px-3 py-2">
        <p className="truncate text-sm font-medium">{user.name ?? (t('account') as string)}</p>
        {user.email && (
          <p className="mt-0.5 truncate text-xs text-[var(--color-fg-muted)]">{user.email}</p>
        )}
      </div>
      <div className="py-1">
        <MenuLink
          href="/settings/profile"
          icon={User}
          label={t('profile') as string}
          onClick={onClose}
        />
        <MenuLink
          href="/settings"
          icon={Settings}
          label={t('settings') as string}
          onClick={onClose}
        />
        <MenuLink
          href="/settings/autonomy"
          icon={Gauge}
          label={t('autonomy') as string}
          onClick={onClose}
        />
        <MenuLink
          href="/settings/billing"
          icon={CreditCard}
          label={t('billing') as string}
          onClick={onClose}
        />
      </div>
      <div className="border-t border-[var(--color-border)] px-2 pb-2 pt-2">
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-fg-subtle)]">
          {t('appearance') as string}
        </p>
        <div className="grid grid-cols-3 gap-1">
          <ModeChip
            active={mode === 'system'}
            onClick={resetToSystem}
            icon={<Monitor className="h-3.5 w-3.5" />}
            label={t('system') as string}
          />
          <ModeChip
            active={mode === 'light'}
            onClick={() => setTheme('soft')}
            icon={<Sun className="h-3.5 w-3.5" />}
            label={t('light') as string}
          />
          <ModeChip
            active={mode === 'dark'}
            onClick={() => setTheme('minimal')}
            icon={<Moon className="h-3.5 w-3.5" />}
            label={t('dark') as string}
          />
        </div>
      </div>
      <div className="px-1 pb-1">
        <button
          type="button"
          onClick={onOpenTheme}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
        >
          <Palette className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t('theme') as string}</span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">{themeLabel}</span>
          <ChevronRight className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
        </button>
        <button
          type="button"
          onClick={onOpenLanguage}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">{t('language') as string}</span>
          <span className="text-[11px] text-[var(--color-fg-subtle)]">{localeLabel}</span>
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
          <span className="flex-1 text-left">{t('signOut') as string}</span>
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
  t,
  onBack,
}: {
  isSystem: boolean;
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  resetToSystem: () => void;
  t: T;
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
        {t('theme') as string}
      </button>
      <div className="border-t border-[var(--color-border)] py-1">
        <ThemeRow
          active={isSystem}
          onClick={resetToSystem}
          icon={<Monitor className="h-3.5 w-3.5" />}
          label={t('system') as string}
          hint={t('matchOs') as string}
        />
        {THEMES.map((th) => (
          <ThemeRow
            key={th.name}
            active={!isSystem && theme === th.name}
            onClick={() => setTheme(th.name)}
            icon={
              <span data-theme={th.name} className="grid h-3.5 w-3.5 place-items-center">
                <span className="block h-3.5 w-3.5 rounded-full border border-[var(--color-border)] bg-[var(--color-brand)]" />
              </span>
            }
            label={th.label}
            hint={th.hint}
          />
        ))}
      </div>
    </motion.div>
  );
}

function LanguageMenu({
  current,
  t,
  onBack,
  onChosen,
}: {
  current: Locale;
  t: T;
  onBack: () => void;
  onChosen: () => void;
}) {
  const [pending, startTransition] = useTransition();
  function pick(loc: Locale) {
    startTransition(async () => {
      await setLocaleAction(loc);
      onChosen();
    });
  }
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
        {t('language') as string}
      </button>
      <div className="border-t border-[var(--color-border)] py-1">
        {LOCALES.map((loc) => {
          const meta = LOCALE_LABELS[loc];
          const active = loc === current;
          return (
            <button
              key={loc}
              type="button"
              disabled={pending}
              onClick={() => pick(loc)}
              className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-[var(--color-bg-elevated)] disabled:opacity-50 ${
                active ? 'text-[var(--color-fg)]' : 'text-[var(--color-fg-muted)]'
              }`}
            >
              <span className="text-base leading-none">{meta.flag}</span>
              <span className="flex-1 text-left">{meta.label}</span>
              {active && <Check className="h-3.5 w-3.5 text-[var(--color-brand)]" />}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] transition-colors ${
        active
          ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-fg)]'
          : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
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
