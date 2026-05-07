'use client';
/**
 * Reusable error display. Used by error boundaries and the client-side error
 * catcher. Renders a friendly heading + collapsible technical details with a
 * one-click "copy as markdown" button so the user can paste a complete report
 * straight into chat.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Home, RotateCcw } from 'lucide-react';
import { Badge, Button, Card } from '@metu/ui';

export interface ErrorContext {
  /** What the user was doing when it happened, if known. */
  scope?: string;
  /** A short human-readable category. */
  kind?: 'render' | 'unhandled' | 'rejection' | 'fatal' | 'fetch';
  error: Error & { digest?: string };
  /** Optional URL/route at the time of the failure. */
  url?: string;
  /** Optional structured extras to include in the copy payload. */
  extras?: Record<string, unknown>;
}

function buildReport({ scope, kind, error, url, extras }: ErrorContext): string {
  const lines: string[] = [];
  lines.push('## metu error report');
  lines.push('');
  lines.push(`- **time**: ${new Date().toISOString()}`);
  lines.push(`- **kind**: ${kind ?? 'render'}`);
  if (scope) lines.push(`- **scope**: ${scope}`);
  if (url ?? (typeof window !== 'undefined' ? window.location.href : null)) {
    lines.push(`- **url**: ${url ?? window.location.href}`);
  }
  if (error.digest) lines.push(`- **digest**: \`${error.digest}\``);
  if (typeof navigator !== 'undefined') {
    lines.push(`- **userAgent**: ${navigator.userAgent}`);
  }
  if (extras && Object.keys(extras).length) {
    lines.push('');
    lines.push('### context');
    lines.push('```json');
    try {
      lines.push(JSON.stringify(extras, null, 2));
    } catch {
      lines.push('[unserializable]');
    }
    lines.push('```');
  }
  lines.push('');
  lines.push('### message');
  lines.push('```');
  lines.push(error.message || '(no message)');
  lines.push('```');
  if (error.stack) {
    lines.push('');
    lines.push('### stack');
    lines.push('```');
    lines.push(error.stack);
    lines.push('```');
  }
  return lines.join('\n');
}

export function ErrorReport({
  context,
  reset,
  variant = 'block',
}: {
  context: ErrorContext;
  reset?: () => void;
  /** `block` = full card on a page; `embedded` = renders without outer Card. */
  variant?: 'block' | 'embedded';
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const report = useMemo(() => buildReport(context), [context]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select the textarea below — it stays in the DOM when open.
      setOpen(true);
    }
  }

  const friendly = friendlyMessage(context);

  const body = (
    <div className="flex items-start gap-4">
      <div className="bg-[var(--color-warning)]/15 grid h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--color-warning)]">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-[var(--color-fg)]">{friendly.title}</h2>
            {context.kind && (
              <Badge size="xs" variant="warning">
                {context.kind}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{friendly.body}</p>
          {context.error.digest && (
            <p className="mt-1 font-mono text-[10px] text-[var(--color-fg-subtle)]">
              ref: {context.error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {reset && (
            <Button size="sm" variant="default" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy details
              </>
            )}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Hide details
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" /> Show details
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              window.location.href = '/dashboard';
            }}
          >
            <Home className="h-3.5 w-3.5" /> Home
          </Button>
        </div>

        {open && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="bg-[var(--color-bg)]/60 max-h-72 overflow-auto rounded-md border border-[var(--color-border)] p-3 text-[11px] leading-relaxed text-[var(--color-fg-muted)]"
          >
            {report}
          </motion.pre>
        )}
      </div>
    </div>
  );

  if (variant === 'embedded') return body;
  return (
    <Card variant="elevated" className="max-w-2xl p-6">
      {body}
    </Card>
  );
}

function friendlyMessage(ctx: ErrorContext): { title: string; body: string } {
  const m = (ctx.error.message || '').toLowerCase();
  if (m.includes('chunk') && m.includes('load')) {
    return {
      title: 'A new version is live',
      body: 'Part of the app could not be loaded. This usually clears with a refresh.',
    };
  }
  if (m.includes('fetch failed') || m.includes('networkerror')) {
    return {
      title: 'Network hiccup',
      body: 'A request did not reach the server. Check your connection and try again.',
    };
  }
  if (m.includes('unauthorized') || m.includes('not authenticated')) {
    return {
      title: 'You were signed out',
      body: 'Your session expired. Sign in again to continue.',
    };
  }
  if (ctx.kind === 'fatal') {
    return {
      title: 'metu hit a wall',
      body:
        ctx.error.message ||
        'An unexpected fatal error occurred. The team has been notified — try reloading.',
    };
  }
  if (ctx.kind === 'rejection') {
    return {
      title: 'A background task failed',
      body:
        ctx.error.message ||
        'An async operation rejected without being handled. The page is still usable.',
    };
  }
  return {
    title: 'Something went wrong here',
    body: ctx.error.message || 'An unexpected error occurred while rendering this page.',
  };
}
