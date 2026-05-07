'use client';
import { Badge, EmptyState, StatusDot } from '@metu/ui';
import { formatDistanceToNow } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Code2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Inbox,
  Link as LinkIcon,
  Mail,
  MessageSquare,
  Mic,
  Paperclip,
} from 'lucide-react';
import Link from 'next/link';

export interface CaptureListItem {
  id: string;
  kind: string;
  status: string;
  content: string | null;
  sourceUrl: string | null;
  source: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  projectName: string | null;
}

const KIND_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  text: FileText,
  voice: Mic,
  screenshot: ImageIcon,
  link: LinkIcon,
  code: Code2,
  email: Mail,
  message: MessageSquare,
  file: Paperclip,
};

function statusToTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'neutral' {
  switch (status) {
    case 'ready':
      return 'success';
    case 'processing':
      return 'info';
    case 'failed':
      return 'danger';
    case 'received':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function CaptureList({ captures }: { captures: CaptureListItem[] }) {
  if (captures.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="h-5 w-5" />}
        title="Nothing matches"
        description="Try clearing filters, or capture something above."
      />
    );
  }

  return (
    <ul className="bg-[var(--color-bg-elevated)]/40 divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
      <AnimatePresence initial={false}>
        {captures.map((c, i) => (
          <CaptureRow key={c.id} capture={c} index={i} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function CaptureRow({ capture, index }: { capture: CaptureListItem; index: number }) {
  const Icon = KIND_ICON[capture.kind] ?? FileText;
  const meta = capture.metadata as {
    imported?: boolean;
    title?: string;
    format?: string;
    messageCount?: number;
    duration?: number;
  };
  const isImported = meta.imported === true;
  const displayTitle = isImported && meta.title ? meta.title : null;
  const previewText = capture.content?.trim() || (capture.sourceUrl ?? '');
  const tone = statusToTone(capture.status);

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12 }}
      transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.2) }}
      className="group relative"
    >
      <Link
        href={`/inbox/${capture.id}`}
        className="flex items-start gap-3 px-3 py-3 transition-colors hover:bg-[var(--color-bg-card)]"
      >
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-bg-card)] text-[var(--color-fg-muted)]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" size="xs" className="capitalize">
              {capture.kind}
            </Badge>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-fg-subtle)]">
              <StatusDot
                state={tone === 'neutral' ? 'neutral' : tone}
                size="xs"
                pulse={capture.status === 'processing'}
              />
              {capture.status}
            </span>
            {capture.projectName ? (
              <Badge variant="brand" size="xs">
                {capture.projectName}
              </Badge>
            ) : null}
            {capture.sourceUrl ? (
              <ExternalLink className="h-3 w-3 text-[var(--color-fg-subtle)]" />
            ) : null}
          </div>
          {displayTitle ? (
            <p className="truncate text-sm font-medium text-[var(--color-fg)]">{displayTitle}</p>
          ) : null}
          <p
            className={
              displayTitle
                ? 'line-clamp-1 text-xs text-[var(--color-fg-muted)]'
                : 'line-clamp-2 text-sm text-[var(--color-fg)]'
            }
          >
            {previewText || (
              <em className="text-[var(--color-fg-subtle)]">
                {capture.status === 'processing' ? 'Processing transcript…' : 'no content'}
              </em>
            )}
          </p>
          <p className="text-[11px] text-[var(--color-fg-subtle)]">
            {formatDistanceToNow(new Date(capture.capturedAt), { addSuffix: true })} ·{' '}
            {capture.source}
            {isImported && meta.messageCount ? ` · ${meta.messageCount} msgs` : ''}
          </p>
        </div>
      </Link>
    </motion.li>
  );
}
