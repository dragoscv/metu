/**
 * Onboarding checklist — server component shown on the dashboard's
 * "now" tab while the workspace is still mostly empty. Each item is a
 * single SQL count (cheap) and a deep link to the place where the user
 * can complete the step. Hides itself once every step is done.
 */
import { count, eq } from 'drizzle-orm';
import { getDb } from '@metu/db';
import { capture, device, goal, project } from '@metu/db/schema';
import { Card } from '@metu/ui';
import { Check, Circle, Plug, Smartphone, Sparkles, Target, FolderKanban } from 'lucide-react';
import Link from 'next/link';
import { SeedDemoButton } from './seed-demo-button';

interface Step {
  id: string;
  done: boolean;
  title: string;
  description: string;
  href: string;
  icon: typeof Check;
}

async function loadSteps(workspaceId: string): Promise<Step[]> {
  const db = getDb();
  const [[p], [c], [d], [g]] = await Promise.all([
    db.select({ n: count() }).from(project).where(eq(project.workspaceId, workspaceId)),
    db.select({ n: count() }).from(capture).where(eq(capture.workspaceId, workspaceId)),
    db.select({ n: count() }).from(device).where(eq(device.workspaceId, workspaceId)),
    db.select({ n: count() }).from(goal).where(eq(goal.workspaceId, workspaceId)),
  ]);
  return [
    {
      id: 'project',
      done: (p?.n ?? 0) > 0,
      title: 'Create your first project',
      description: 'metu organises everything around projects you actually care about.',
      href: '/projects',
      icon: FolderKanban,
    },
    {
      id: 'capture',
      done: (c?.n ?? 0) > 0,
      title: 'Capture a thought',
      description: 'Drop anything in the brain dump — a note, a link, a half-formed idea.',
      href: '/inbox',
      icon: Sparkles,
    },
    {
      id: 'goal',
      done: (g?.n ?? 0) > 0,
      title: 'Set a goal',
      description: 'Goals tell the Conductor what to optimise for week to week.',
      href: '/goals',
      icon: Target,
    },
    {
      id: 'device',
      done: (d?.n ?? 0) > 0,
      title: 'Connect a device',
      description: 'Install the companion or mobile app so metu can see your day.',
      href: '/devices',
      icon: Smartphone,
    },
  ];
}

export async function OnboardingChecklist({ workspaceId }: { workspaceId: string }) {
  const steps = await loadSteps(workspaceId);
  const remaining = steps.filter((s) => !s.done);
  if (remaining.length === 0) return null;
  const done = steps.length - remaining.length;
  const pct = Math.round((done / steps.length) * 100);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium">Get set up</h2>
          <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
            {remaining.length} step{remaining.length === 1 ? '' : 's'} left to unlock the full
            Conductor experience.
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-[var(--color-fg-subtle)]">{pct}%</span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-[var(--color-bg-elevated)]">
        <div
          className="h-full bg-[var(--color-brand)] transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="space-y-1.5">
        {steps.map((s) => {
          const Icon = s.icon;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                className={`flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 transition hover:border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)] ${
                  s.done ? 'opacity-60' : ''
                }`}
              >
                {s.done ? (
                  <Check className="h-4 w-4 text-[var(--color-success)]" />
                ) : (
                  <Circle className="h-4 w-4 text-[var(--color-fg-subtle)]" />
                )}
                <Icon className="h-4 w-4 text-[var(--color-fg-muted)]" />
                <div className="flex-1">
                  <div
                    className={`text-sm ${s.done ? 'line-through' : 'text-[var(--color-fg)]'}`}
                  >
                    {s.title}
                  </div>
                  {!s.done && (
                    <div className="text-[11px] text-[var(--color-fg-subtle)]">
                      {s.description}
                    </div>
                  )}
                </div>
                {!s.done && (
                  <Plug className="h-3.5 w-3.5 -rotate-45 text-[var(--color-fg-subtle)]" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {steps[0] && !steps[0].done && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <SeedDemoButton />
        </div>
      )}
    </Card>
  );
}
