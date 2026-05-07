'use client';
/**
 * Catches uncaught client-side errors that React's error boundaries miss:
 *   - `window.onerror` (synchronous errors, scripts, image/onerror, etc.)
 *   - `unhandledrejection` (Promise rejections without a `.catch`)
 *
 * Surfaces a discreet sonner toast with a "Copy details" action that puts a
 * markdown error report on the clipboard, ready to paste into chat. The
 * boundaries (`error.tsx`) still own anything that happens during rendering.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const SUPPRESS_PATTERNS = [
  // Common benign noise from extensions, devtools, sw.
  'ResizeObserver loop',
  'Non-Error promise rejection captured',
  'Script error.',
];

function shouldSuppress(message: string): boolean {
  return SUPPRESS_PATTERNS.some((p) => message.includes(p));
}

function buildReport(opts: {
  kind: 'unhandled' | 'rejection';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
}): string {
  const lines: string[] = [
    '## metu client error',
    '',
    `- **time**: ${new Date().toISOString()}`,
    `- **kind**: ${opts.kind}`,
    `- **url**: ${window.location.href}`,
    `- **userAgent**: ${navigator.userAgent}`,
  ];
  if (opts.source) {
    lines.push(
      `- **source**: ${opts.source}${opts.lineno != null ? `:${opts.lineno}:${opts.colno ?? 0}` : ''}`,
    );
  }
  lines.push('', '### message', '```', opts.message || '(no message)', '```');
  if (opts.stack) lines.push('', '### stack', '```', opts.stack, '```');
  return lines.join('\n');
}

async function copyReport(report: string) {
  try {
    await navigator.clipboard.writeText(report);
    toast.success('Error details copied to clipboard.');
  } catch {
    toast.error('Could not copy. Open DevTools console for the full trace.');
  }
}

export function ErrorCatcher() {
  // Throttle: don't spam the user if a render loop fires the same error.
  const lastRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    function show(report: string, friendly: string) {
      toast.error(friendly, {
        description: 'Copy a debug report you can paste to your assistant.',
        duration: 8000,
        action: {
          label: 'Copy details',
          onClick: () => {
            void copyReport(report);
          },
        },
      });
    }

    function dedupe(key: string): boolean {
      const now = Date.now();
      if (lastRef.current && lastRef.current.key === key && now - lastRef.current.at < 4000) {
        return true;
      }
      lastRef.current = { key, at: now };
      return false;
    }

    function onError(ev: ErrorEvent) {
      const msg = ev.message ?? 'Unknown error';
      if (shouldSuppress(msg)) return;
      if (dedupe(`err:${msg}`)) return;
      const report = buildReport({
        kind: 'unhandled',
        message: msg,
        stack: ev.error instanceof Error ? ev.error.stack : undefined,
        source: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
      const friendly =
        msg.toLowerCase().includes('chunk') && msg.toLowerCase().includes('load')
          ? 'A new version is live — please refresh.'
          : 'Something broke in the background.';
      show(report, friendly);
    }

    function onRejection(ev: PromiseRejectionEvent) {
      const reason = ev.reason;
      const message =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : (() => {
                try {
                  return JSON.stringify(reason);
                } catch {
                  return String(reason);
                }
              })();
      if (shouldSuppress(message)) return;
      if (dedupe(`rej:${message}`)) return;
      const report = buildReport({
        kind: 'rejection',
        message,
        stack: reason instanceof Error ? reason.stack : undefined,
      });
      show(report, 'A background task failed.');
    }

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
