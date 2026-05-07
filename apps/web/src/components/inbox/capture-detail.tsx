'use client';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Page,
  PageHeader,
  Select,
  StatusDot,
  Textarea,
} from '@metu/ui';
import { format, formatDistanceToNow } from 'date-fns';
import { ExternalLink, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  deleteCaptureAction,
  retryCaptureAction,
  updateCaptureAction,
} from '@/app/actions/captures';

export interface CaptureDetailItem {
  id: string;
  kind: string;
  status: string;
  content: string | null;
  sourceUrl: string | null;
  source: string;
  capturedAt: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  storageKey: string | null;
}

function statusToTone(status: string) {
  switch (status) {
    case 'ready':
      return 'success' as const;
    case 'processing':
      return 'info' as const;
    case 'failed':
      return 'danger' as const;
    default:
      return 'neutral' as const;
  }
}

export function CaptureDetail({
  capture,
  projects,
}: {
  capture: CaptureDetailItem;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [content, setContent] = useState(capture.content ?? '');
  const [projectId, setProjectId] = useState(capture.projectId ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const meta = capture.metadata as {
    imported?: boolean;
    title?: string;
    format?: string;
    messageCount?: number;
    duration?: number;
    mime?: string;
    size?: number;
    aiClassification?: string;
  };
  const isImported = meta.imported === true;
  const dirty = content !== (capture.content ?? '') || projectId !== (capture.projectId ?? '');

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCaptureAction({
        id: capture.id,
        content,
        projectId: projectId || null,
      });
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  function remove() {
    if (!confirm('Delete this capture? This cannot be undone.')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteCaptureAction(capture.id);
      if (!res.ok) setError(res.error);
      else router.push('/inbox');
    });
  }

  function retry() {
    setError(null);
    startTransition(async () => {
      const res = await retryCaptureAction(capture.id);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  const tone = statusToTone(capture.status);

  return (
    <Page>
      <PageHeader
        size="sm"
        back={{ href: '/inbox', label: 'Inbox' }}
        title={
          isImported && meta.title
            ? meta.title
            : capture.kind === 'text'
              ? 'Text capture'
              : `${capture.kind} capture`
        }
        eyebrow={
          <>
            <Badge variant="outline" size="sm" className="capitalize">
              {capture.kind}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
              <StatusDot
                state={tone === 'neutral' ? 'neutral' : tone}
                size="sm"
                pulse={capture.status === 'processing'}
              />
              {capture.status}
            </span>
          </>
        }
        actions={
          <>
            {capture.status === 'failed' ? (
              <Button variant="subtle" size="sm" disabled={pending} onClick={retry}>
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        }
      />

      <Card className="space-y-4 p-5">
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-fg-subtle)]">Captured</dt>
            <dd
              className="text-[var(--color-fg)]"
              title={format(new Date(capture.capturedAt), 'PPpp')}
            >
              {formatDistanceToNow(new Date(capture.capturedAt), { addSuffix: true })}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-fg-subtle)]">Source</dt>
            <dd className="text-[var(--color-fg)]">{capture.source}</dd>
          </div>
          {meta.format ? (
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Format</dt>
              <dd className="text-[var(--color-fg)]">{meta.format}</dd>
            </div>
          ) : null}
          {meta.messageCount ? (
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Messages</dt>
              <dd className="text-[var(--color-fg)]">{meta.messageCount}</dd>
            </div>
          ) : null}
          {meta.duration ? (
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Duration</dt>
              <dd className="text-[var(--color-fg)]">{Math.round(meta.duration)}s</dd>
            </div>
          ) : null}
          {meta.mime ? (
            <div>
              <dt className="text-[var(--color-fg-subtle)]">MIME</dt>
              <dd className="text-[var(--color-fg)]">{meta.mime}</dd>
            </div>
          ) : null}
          {capture.sourceUrl ? (
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-[var(--color-fg-subtle)]">URL</dt>
              <dd>
                <a
                  href={capture.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 truncate text-[var(--color-brand)] hover:underline"
                >
                  {capture.sourceUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <CardTitle>Content</CardTitle>
          {capture.kind === 'voice' && capture.status === 'processing' ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-fg-muted)]">
              <StatusDot state="info" size="xs" pulse />
              Transcribing…
            </span>
          ) : null}
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={Math.max(6, Math.min(20, content.split('\n').length + 2))}
          placeholder={
            capture.status === 'processing'
              ? 'Processing transcript…'
              : 'No content yet — type to add notes.'
          }
          className="font-mono text-sm"
        />
      </Card>

      <Card className="space-y-3 p-5">
        <CardTitle>Assignment</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-muted)]">
            Project
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="min-w-[200px]"
            >
              <option value="">— Unassigned —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      {error ? (
        <p className="rounded-md border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={!dirty || pending} className="gap-2 shadow-lg">
          <Save className="h-4 w-4" />
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Page>
  );
}
