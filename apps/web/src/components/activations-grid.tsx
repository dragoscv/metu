'use client';
/**
 * Slice 10 — Active activations grid. Reads from `listActivations` on the
 * server and renders a card per row with a "Deactivate" button.
 */
import { useState, useTransition } from 'react';
import { Button, Card, CardTitle } from '@metu/ui';
import { deactivatePersonaAction, type ActivationViewRow } from '@/app/actions/presence';

export function ActivationsGrid({
  initial,
  personaName,
}: {
  initial: ActivationViewRow[];
  /** Map<personaId, prettyName> so we don't have to re-fetch personas client-side. */
  personaName: Record<string, string>;
}) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-xs text-[var(--color-fg-muted)]">
        No personas are currently activated. Open the companion or mobile app to bring one online.
      </p>
    );
  }

  function deactivate(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    startTransition(async () => {
      await deactivatePersonaAction(id);
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => (
        <Card key={r.id} className="flex flex-col gap-2 p-4">
          <CardTitle>{personaName[r.personaId] ?? 'Persona'}</CardTitle>
          <p className="text-xs text-[var(--color-fg-muted)]">
            {r.deviceName ?? 'Unknown device'}
            {r.deviceKind ? ` · ${r.deviceKind}` : ''}
          </p>
          <p className="text-xs">
            Form: <span className="font-mono">{r.form}</span>
          </p>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => deactivate(r.id)}>
            Deactivate
          </Button>
        </Card>
      ))}
    </div>
  );
}
