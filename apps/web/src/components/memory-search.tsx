'use client';
import { useState, useTransition } from 'react';
import { Search } from 'lucide-react';
import { Button, Input } from '@metu/ui';
import { recallAction } from '@/app/actions/recall';

interface Hit {
  id: string;
  content: string;
  similarity: number;
  source_kind: string;
  created_at: string;
}

export function MemorySearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="flex gap-2">
        <Input
          placeholder="What were we doing about Stripe webhooks 2 weeks ago?"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              start(async () => {
                const r = await recallAction(q);
                if (r.ok) setHits(r.hits as Hit[]);
              });
            }
          }}
        />
        <Button
          disabled={pending || !q.trim()}
          onClick={() =>
            start(async () => {
              const r = await recallAction(q);
              if (r.ok) setHits(r.hits as Hit[]);
            })
          }
        >
          <Search className="h-4 w-4" />
          {pending ? 'Searching…' : 'Recall'}
        </Button>
      </div>
      <ul className="mt-6 space-y-3">
        {hits.map((h) => (
          <li
            key={h.id}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3"
          >
            <div className="mb-1 flex items-center justify-between text-xs text-[var(--color-fg-subtle)]">
              <span className="uppercase tracking-wider">{h.source_kind}</span>
              <span>{Math.round(h.similarity * 100)}% match</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">{h.content}</p>
          </li>
        ))}
        {!pending && hits.length === 0 && q && (
          <li className="text-sm text-[var(--color-fg-subtle)]">No memories yet.</li>
        )}
      </ul>
    </div>
  );
}
