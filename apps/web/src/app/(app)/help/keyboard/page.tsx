import { auth } from '@metu/auth';
import { redirect } from 'next/navigation';
import { Card, CardTitle, Page, PageHeader } from '@metu/ui';

const SHORTCUTS: { group: string; items: { keys: string; label: string }[] }[] = [
  {
    group: 'Global',
    items: [
      { keys: 'Cmd/Ctrl+K', label: 'Command palette' },
      { keys: 'Cmd/Ctrl+J', label: 'Toggle Conductor drawer' },
      { keys: 'Cmd/Ctrl+Shift+K', label: 'Quick capture' },
      { keys: '?', label: 'This help' },
      { keys: '/', label: 'Focus search/filter on page' },
      { keys: 'Esc', label: 'Close drawer / modal' },
    ],
  },
  {
    group: 'Navigation (g then…)',
    items: [
      { keys: 'g D', label: 'Now (focus)' },
      { keys: 'g I', label: 'Brain dump' },
      { keys: 'g P', label: 'Projects' },
      { keys: 'g G', label: 'Goals & targets' },
      { keys: 'g T', label: 'Timeline' },
      { keys: 'g M', label: 'Memory' },
      { keys: 'g C', label: 'Conductor' },
      { keys: 'g A', label: 'Agents' },
      { keys: 'g S', label: 'Settings' },
    ],
  },
  {
    group: 'Goals',
    items: [
      { keys: 'Click "Quick check-in"', label: 'Inline progress slider' },
      { keys: 'Click "Recompute drift"', label: 'Force on-track / slipping / stalled refresh' },
    ],
  },
  {
    group: 'Conductor',
    items: [{ keys: 'Cmd/Ctrl+Enter', label: 'Send message (in capture / chat input)' }],
  },
];

export default async function KeyboardHelpPage() {
  const session = await auth();
  if (!session) redirect('/sign-in');
  return (
    <Page>
      <PageHeader
        title="Keyboard shortcuts"
        description="metu is button-first; every workflow is reachable by mouse. These shortcuts speed up the most common moves."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {SHORTCUTS.map((g) => (
          <Card key={g.group}>
            <CardTitle>{g.group}</CardTitle>
            <ul className="mt-3 space-y-2">
              {g.items.map((s) => (
                <li
                  key={s.keys + s.label}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-[var(--color-fg-muted)]">{s.label}</span>
                  <kbd className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-fg)]">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </Page>
  );
}
