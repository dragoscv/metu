'use client';
import { Button, Input } from '@metu/ui';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteDecisionAction, updateDecisionAction } from '@/app/actions/project';

export interface DecisionEditData {
  id: string;
  title: string;
  rationale: string;
  alternatives: { name: string; reason?: string }[];
}

export function DecisionEditForm({
  decision,
  backHref,
}: {
  decision: DecisionEditData;
  backHref: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(decision.title);
  const [rationale, setRationale] = useState(decision.rationale);
  const [alts, setAlts] = useState<{ name: string; reason?: string }[]>(decision.alternatives);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, startSave] = useTransition();
  const [pendingDelete, startDelete] = useTransition();

  const dirty =
    title !== decision.title ||
    rationale !== decision.rationale ||
    JSON.stringify(alts) !== JSON.stringify(decision.alternatives);

  const save = () => {
    setError(null);
    startSave(async () => {
      const res = await updateDecisionAction({
        id: decision.id,
        title: title.trim(),
        rationale: rationale.trim(),
        alternatives: alts.filter((a) => a.name.trim().length > 0),
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  const onDelete = () => {
    if (!confirm('Delete this decision?')) return;
    startDelete(async () => {
      const res = await deleteDecisionAction(decision.id);
      if (!res.ok) setError(res.error);
      else router.push(backHref);
    });
  };

  const updateAlt = (i: number, patch: Partial<{ name: string; reason: string }>) => {
    setAlts((arr) => arr.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  return (
    <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-5">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--color-fg-muted)]">Rationale</label>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={6}
          className="w-full resize-y rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--color-fg-muted)]">
            Alternatives considered
          </label>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setAlts((arr) => [...arr, { name: '' }])}
          >
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
        {alts.length === 0 && (
          <p className="text-xs italic text-[var(--color-fg-subtle)]">No alternatives recorded.</p>
        )}
        <ul className="space-y-2">
          {alts.map((a, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2"
            >
              <div className="flex-1 space-y-1.5">
                <Input
                  value={a.name}
                  onChange={(e) => updateAlt(i, { name: e.target.value })}
                  placeholder="Option name"
                />
                <Input
                  value={a.reason ?? ''}
                  onChange={(e) => updateAlt(i, { reason: e.target.value })}
                  placeholder="Why not chosen (optional)"
                />
              </div>
              <button
                type="button"
                aria-label="Remove alternative"
                onClick={() => setAlts((arr) => arr.filter((_, idx) => idx !== i))}
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-danger)]"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <div className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-4">
        <Button variant="danger" size="sm" onClick={onDelete} disabled={pendingDelete}>
          {pendingDelete ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Delete
        </Button>
        <Button
          onClick={save}
          disabled={!dirty || pendingSave || !title.trim() || !rationale.trim()}
          size="sm"
        >
          {pendingSave ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}
