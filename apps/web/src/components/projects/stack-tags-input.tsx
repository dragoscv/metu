'use client';
import { Button, Input } from '@metu/ui';
import { Plus, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';

const SUGGESTIONS = [
  'next.js',
  'react',
  'typescript',
  'drizzle',
  'postgres',
  'tailwind',
  'tauri',
  'expo',
  'python',
  'rust',
  'docker',
  'gcp',
  'stripe',
];

export function StackTagsInput({
  value,
  onChange,
  className,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const filtered = SUGGESTIONS.filter(
    (s) => s.includes(draft.toLowerCase()) && !value.includes(s),
  ).slice(0, 6);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 focus-within:ring-2 focus-within:ring-[var(--color-brand)]">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-card)] px-2 py-0.5 text-xs"
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
              className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={value.length === 0 ? 'next.js, drizzle, …' : 'Add tag'}
          className="min-w-[8rem] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-[var(--color-fg-subtle)]"
        />
      </div>
      {draft && filtered.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="inline-flex items-center gap-0.5 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[11px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elevated)]"
            >
              <Plus className="h-2.5 w-2.5" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const colors = [
    null,
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#f43f5e',
    '#f59e0b',
    '#10b981',
    '#14b8a6',
    '#06b6d4',
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c) => (
        <button
          key={c ?? 'default'}
          type="button"
          onClick={() => onChange(c)}
          className={`h-7 w-7 rounded-full border-2 ${value === c ? 'border-[var(--color-fg)]' : 'border-transparent'}`}
          style={{ background: c ?? 'var(--color-brand)' }}
          aria-label={c ?? 'Brand default'}
          title={c ?? 'Default'}
        />
      ))}
    </div>
  );
}

export { Input as _Input, Button as _Button };
