'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Palette } from 'lucide-react';
import { THEMES, useTheme } from './theme-provider';

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const current = THEMES.find((t) => t.name === theme) ?? THEMES[0]!;

  return (
    <div className="relative mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-card)] hover:text-[var(--color-fg)]"
      >
        <Palette className="h-4 w-4" />
        <span className="flex-1 truncate text-left">Theme: {current.label}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1 shadow-xl"
          >
            {THEMES.map((t) => (
              <li key={t.name}>
                <button
                  type="button"
                  onClick={() => {
                    setTheme(t.name);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-bg-elevated)]"
                >
                  <span className="flex-1">
                    <span className="block">{t.label}</span>
                    <span className="block text-[10px] text-[var(--color-fg-subtle)]">
                      {t.hint}
                    </span>
                  </span>
                  {theme === t.name && <Check className="h-3.5 w-3.5 text-[var(--color-brand)]" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
