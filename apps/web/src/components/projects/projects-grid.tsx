'use client';
import { Badge, MomentumBar } from '@metu/ui';
import { motion } from 'framer-motion';
import { CheckSquare, Github, Globe, Hash, Layers, Link2, Target } from 'lucide-react';
import Link from 'next/link';
import type { ComponentType } from 'react';

export interface ProjectCardData {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  stateSummary: string | null;
  status: string;
  momentumScore: number;
  lastMeaningfulActivityAt: string | null;
  color: string | null;
  stack: string[] | null;
  links: { provider: string; kind: string; count: number }[];
  openTasks: number;
  blockedTasks: number;
  goals: number;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
  killed: 'danger',
};

const PROVIDER_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  github: Github,
  gitlab: Github,
  notion: Layers,
  linear: Layers,
  slack: Hash,
  gdrive: Layers,
  figma: Layers,
  generic: Globe,
};

function relativeTime(iso: string | null) {
  if (!iso) return 'No activity yet';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProjectsGrid({ projects }: { projects: ProjectCardData[] }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p, i) => {
        const grouped = new Map<string, number>();
        for (const l of p.links) grouped.set(l.provider, (grouped.get(l.provider) ?? 0) + l.count);

        return (
          <motion.li
            key={p.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
            layout
          >
            <Link
              href={`/projects/${p.id}`}
              className="group block h-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 transition hover:border-[var(--color-brand)] hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: p.color ?? 'var(--color-brand)' }}
                  />
                  <h3 className="truncate text-sm font-semibold tracking-tight">{p.name}</h3>
                </div>
                <Badge variant={STATUS_TONE[p.status] ?? 'neutral'} size="sm">
                  {p.status}
                </Badge>
              </div>

              {p.summary && (
                <p className="mt-2 line-clamp-2 text-xs text-[var(--color-fg-muted)]">
                  {p.summary}
                </p>
              )}
              {!p.summary && p.stateSummary && (
                <p className="mt-2 line-clamp-2 text-xs italic text-[var(--color-fg-subtle)]">
                  {p.stateSummary}
                </p>
              )}

              <div className="mt-4">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
                  <span>Momentum</span>
                  <span>{Math.round(p.momentumScore * 100)}%</span>
                </div>
                <MomentumBar value={p.momentumScore} className="mt-1" />
              </div>

              {(grouped.size > 0 || p.openTasks > 0 || p.blockedTasks > 0 || p.goals > 0) && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {Array.from(grouped.entries()).map(([provider, count]) => {
                    const Icon = PROVIDER_ICONS[provider] ?? Link2;
                    return (
                      <span
                        key={provider}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-muted)]"
                        title={`${count} ${provider} link${count > 1 ? 's' : ''}`}
                      >
                        <Icon className="h-3 w-3" />
                        {count}
                      </span>
                    );
                  })}
                  {p.openTasks > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-muted)]"
                      title={`${p.openTasks} open tasks`}
                    >
                      <CheckSquare className="h-3 w-3" />
                      {p.openTasks}
                    </span>
                  )}
                  {p.blockedTasks > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-warning)]"
                      title={`${p.blockedTasks} blocked`}
                    >
                      <CheckSquare className="h-3 w-3" />
                      {p.blockedTasks}
                    </span>
                  )}
                  {p.goals > 0 && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-fg-muted)]"
                      title={`${p.goals} goals`}
                    >
                      <Target className="h-3 w-3" />
                      {p.goals}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--color-fg-subtle)]">
                <span>{relativeTime(p.lastMeaningfulActivityAt)}</span>
                {p.stack && p.stack.length > 0 && (
                  <span className="truncate">{p.stack.slice(0, 3).join(' · ')}</span>
                )}
              </div>
            </Link>
          </motion.li>
        );
      })}
    </ul>
  );
}
