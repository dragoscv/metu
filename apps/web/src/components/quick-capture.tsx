'use client';
import { useEffect, useState, useTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { createCapture } from '@/app/actions/capture';

/**
 * Cmd/Ctrl+Shift+K — quick capture modal. Posts a `text` capture into the brain dump.
 */
export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isShortcut = (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k';
      if (isShortcut) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function submit() {
    const text = content.trim();
    if (!text) return;
    startTransition(async () => {
      const r = await createCapture({ kind: 'text', content: text, source: 'web', metadata: {} });
      if (r.ok) {
        toast.success('Captured');
        setContent('');
        setOpen(false);
      } else {
        toast.error(r.error);
      }
    });
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
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
              <span className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
                <Sparkles className="h-3.5 w-3.5 text-[var(--color-brand)]" />
                Quick capture
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
              }}
              placeholder="Drop a thought, link, or task. Cmd+Enter to save."
              className="h-32 w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
            />
            <div className="flex items-center justify-between border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-fg-subtle)]">
              <span>Tagged source: web · Routed to Brain dump</span>
              <button
                type="button"
                onClick={submit}
                disabled={pending || !content.trim()}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-brand)] px-3 py-1 text-xs text-[var(--color-brand-fg)] disabled:opacity-50"
              >
                {pending ? 'Saving…' : 'Capture'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
