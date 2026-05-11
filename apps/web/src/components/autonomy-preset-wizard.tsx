'use client';

import { useState, useTransition } from 'react';
import { Card, Button } from '@metu/ui';
import { Eye, MessageSquare, Zap, Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { applyAutonomyPresetAction } from '@/app/actions/autonomy-preset';

type Preset = 'observe' | 'ask' | 'autopilot';

const OPTIONS: Array<{
  key: Preset;
  title: string;
  tagline: string;
  bullets: string[];
  Icon: typeof Eye;
}> = [
  {
    key: 'observe',
    title: 'Observe only',
    tagline: 'Watch and remember. Never act.',
    bullets: [
      'Captures everything, builds memory.',
      'Surfaces nothing without you asking.',
      'Cost cap $0/day, action cap 0.',
    ],
    Icon: Eye,
  },
  {
    key: 'ask',
    title: 'Ask first',
    tagline: 'Suggest and confirm. The default.',
    bullets: [
      'Conductor proposes, you approve.',
      'Cost cap $2/day, 50 actions/day.',
      'Notifications at level 40 (balanced).',
    ],
    Icon: MessageSquare,
  },
  {
    key: 'autopilot',
    title: 'Autopilot with undo',
    tagline: 'Just do it. Keep a clear undo log.',
    bullets: [
      'Acts immediately on observable signals.',
      'Cost cap $10/day, 200 actions/day.',
      'Every action shows up in /audit with one-click undo.',
    ],
    Icon: Zap,
  },
];

export function AutonomyPresetWizard({ initial }: { initial: Preset }) {
  const [picked, setPicked] = useState<Preset>(initial);
  const [pending, start] = useTransition();
  const router = useRouter();

  const apply = () =>
    start(async () => {
      const r = await applyAutonomyPresetAction({ preset: picked });
      if (r.ok) {
        toast.success(`Applied "${picked}" preset.`);
        router.push('/dashboard');
      } else {
        toast.error(r.error);
      }
    });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = picked === o.key;
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => setPicked(o.key)}
              className={`text-left transition ${active ? 'scale-[1.01]' : 'opacity-90 hover:opacity-100'}`}
            >
              <Card
                className={`h-full space-y-2 ${
                  active ? 'border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <o.Icon className="h-5 w-5 text-[var(--color-brand)]" />
                  {active ? <Check className="h-4 w-4 text-[var(--color-brand)]" /> : null}
                </div>
                <div>
                  <div className="font-semibold">{o.title}</div>
                  <div className="text-xs text-[var(--color-fg-muted)]">{o.tagline}</div>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-[var(--color-fg-muted)]">
                  {o.bullets.map((b) => (
                    <li key={b}>— {b}</li>
                  ))}
                </ul>
              </Card>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--color-fg-subtle)]">
          You can fine-tune per-tool overrides in <code>/settings/agents</code>.
        </span>
        <Button onClick={apply} disabled={pending}>
          {pending ? 'Applying…' : 'Apply preset'}
        </Button>
      </div>
    </div>
  );
}
