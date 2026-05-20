'use client';
/**
 * Inline "Record a decision" form for /decisions. Uses useActionState +
 * logDecisionAction so the page revalidates server-side on success.
 *
 * Minimal fields: title, rationale, optional projectId. The agent's
 * propose_decision tool can fill in alternatives if needed.
 */
import { useActionState, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Loader2, Check } from 'lucide-react';
import { logDecisionAction } from '@/app/actions/project';

interface ProjectOption {
  id: string;
  name: string;
}

interface State {
  ok: boolean;
  error?: string;
}

const initialState: State = { ok: false };

async function submit(_prev: State, formData: FormData): Promise<State> {
  const title = String(formData.get('title') ?? '').trim();
  const rationale = String(formData.get('rationale') ?? '').trim();
  const projectId = String(formData.get('projectId') ?? '').trim();
  if (!title || !rationale) return { ok: false, error: 'Title and rationale are required.' };
  const r = await logDecisionAction({
    title,
    rationale,
    projectId: projectId || undefined,
    alternatives: [],
    metadata: {},
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

export function DecisionForm({ projects }: { projects: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(submit, initialState);

  // Auto-close 1.2s after a successful save (page revalidates server-side).
  if (state.ok && open) {
    setTimeout(() => setOpen(false), 1200);
  }

  return (
    <div className="mb-4">
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.form
            key="form"
            action={action}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)]"
          >
            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Record a decision</h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Cancel"
                  className="rounded p-1 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-overlay)] hover:text-[var(--color-fg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                name="title"
                required
                maxLength={280}
                placeholder="e.g. Use Postgres for the queue instead of Redis"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
              <textarea
                name="rationale"
                required
                maxLength={20_000}
                rows={3}
                placeholder="Why this, and what did you consider instead?"
                className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
              {projects.length > 0 ? (
                <select
                  name="projectId"
                  defaultValue=""
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
                >
                  <option value="">— No project (workspace-wide) —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {state.error ? (
                <p className="text-xs text-[var(--color-danger)]">{state.error}</p>
              ) : null}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : state.ok ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : null}
                  {state.ok ? 'Recorded' : pending ? 'Saving…' : 'Record decision'}
                </button>
              </div>
            </div>
          </motion.form>
        ) : (
          <motion.button
            key="trigger"
            type="button"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="hover:border-[var(--color-brand)]/40 inline-flex items-center gap-1.5 rounded-md border border-dashed border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Record a decision
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
