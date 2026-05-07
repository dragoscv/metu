'use client';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import Link from 'next/link';

/**
 * Right-side drawer that loads the Conductor chat at /chat inside an iframe.
 * Toggle with Cmd/Ctrl+J. Escape closes.
 */
export function ConductorDrawer() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-xl flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Conductor</h2>
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  Cmd+J to toggle · Esc to close
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/chat"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
                  title="Open full page"
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>
            <div className="flex-1 overflow-hidden">
              <iframe
                src="/embed/conductor"
                className="h-full w-full border-0 bg-[var(--color-bg)]"
                title="Conductor"
              />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
