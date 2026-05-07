'use client';
import { Badge } from '@metu/ui';
import { motion } from 'framer-motion';
import { CheckCircle2, Circle, ExternalLink, Github, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTransition } from 'react';
import { markTaskDoneAction, markTaskUndoneAction } from '@/app/actions/project';

export interface TaskRowData {
  id: string;
  title: string;
  status: string;
  kind: string;
  leverageScore: number | null;
  blockedReason: string | null;
  dueAt: string | null;
  sourceApp?: string | null;
  sourceUrl?: string | null;
}

type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
const STATUS_TONE: Record<string, BadgeTone> = {
  doing: 'info',
  next: 'brand',
  inbox: 'neutral',
  blocked: 'warning',
  done: 'success',
  dropped: 'neutral',
};

const KIND_TONE: Record<string, 'brand' | 'info' | 'neutral'> = {
  deep: 'brand',
  creative: 'info',
  shallow: 'neutral',
  maintenance: 'neutral',
};

export function TaskRow({
  task,
  href,
  index = 0,
}: {
  task: TaskRowData;
  href: string;
  index?: number;
}) {
  const [pending, start] = useTransition();
  const isDone = task.status === 'done';

  const toggle = () => {
    start(async () => {
      if (isDone) await markTaskUndoneAction(task.id);
      else await markTaskDoneAction(task.id);
    });
  };

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
      layout
      className="group flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 transition hover:border-[var(--color-brand)]"
    >
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={isDone ? 'Mark as not done' : 'Mark as done'}
        className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--color-fg-muted)] transition hover:text-[var(--color-fg)] disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isDone ? (
          <CheckCircle2 className="h-5 w-5 text-[var(--color-success)]" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>
      <Link href={href} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm ${isDone ? 'text-[var(--color-fg-subtle)] line-through' : 'text-[var(--color-fg)]'}`}
          >
            {task.title}
          </span>
        </div>
        {task.blockedReason && (
          <p className="mt-0.5 line-clamp-1 text-xs text-[var(--color-warning)]">
            ⚠ {task.blockedReason}
          </p>
        )}
      </Link>
      <div className="flex shrink-0 items-center gap-1.5">
        {task.sourceUrl && (
          <a
            href={task.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5 rounded p-0.5 text-[var(--color-fg-subtle)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-fg)]"
            title={`Open in ${task.sourceApp ?? 'source'}`}
          >
            {task.sourceApp === 'github' ? (
              <Github className="h-3.5 w-3.5" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )}
          </a>
        )}
        {typeof task.leverageScore === 'number' && task.leverageScore > 0 && (
          <span className="text-[10px] tabular-nums text-[var(--color-fg-subtle)]">
            ↑{task.leverageScore.toFixed(1)}
          </span>
        )}
        <Badge variant={KIND_TONE[task.kind] ?? 'neutral'} size="xs">
          {task.kind}
        </Badge>
        <Badge variant={STATUS_TONE[task.status] ?? 'neutral'} size="xs">
          {task.status}
        </Badge>
      </div>
    </motion.li>
  );
}
