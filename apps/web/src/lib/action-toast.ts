/**
 * Toast helper for client-initiated actions.
 *
 * Two flavors:
 *   - `notify(...)`        — passive system toast (info/success/warn/error)
 *   - `runAction(opts)`    — wraps a Promise/server-action with a loading
 *                            toast, then success or a rich error toast with
 *                            "Copy details" + collapsible payload (markdown
 *                            report ready to paste into chat).
 *
 * The error toast gives the user a single button to dump a copy-pasteable
 * report — identical format to `<ErrorReport>` so any failure surface in the
 * app produces the same shape of report.
 */
import { toast, type ExternalToast } from 'sonner';

export interface ActionToastOpts<T> {
  /** Loading title — past tense reads weirdly here, prefer "Re-indexing repo". */
  title: string;
  /** Loading description — explains *what* is happening, kept short. */
  description?: string;
  /** Override on success. Defaults to "<title> complete". */
  successTitle?: string | ((result: T) => string);
  successDescription?: string | ((result: T) => string | undefined);
  /** Override on error. Defaults to "<title> failed". */
  errorTitle?: string;
  /** Where this came from (component, action name). Included in the report. */
  scope?: string;
  /** Extra structured context for the report (id, args, etc.). */
  extras?: Record<string, unknown>;
  /** The work to run. Server actions usually return `{ok, error?}`. */
  fn: () => Promise<T>;
}

export interface ServerActionResult {
  ok: boolean;
  error?: string;
}

function isServerActionResult(v: unknown): v is ServerActionResult {
  return !!v && typeof v === 'object' && 'ok' in (v as Record<string, unknown>);
}

function buildReport(opts: {
  title: string;
  scope?: string;
  error: Error;
  extras?: Record<string, unknown>;
}): string {
  const lines: string[] = [
    '## metu action error',
    '',
    `- **time**: ${new Date().toISOString()}`,
    `- **action**: ${opts.title}`,
  ];
  if (opts.scope) lines.push(`- **scope**: ${opts.scope}`);
  if (typeof window !== 'undefined') lines.push(`- **url**: ${window.location.href}`);
  if (typeof navigator !== 'undefined') lines.push(`- **userAgent**: ${navigator.userAgent}`);
  if (opts.extras && Object.keys(opts.extras).length) {
    lines.push('', '### context', '```json');
    try {
      lines.push(JSON.stringify(opts.extras, null, 2));
    } catch {
      lines.push('[unserializable]');
    }
    lines.push('```');
  }
  lines.push('', '### message', '```', opts.error.message || '(no message)', '```');
  if (opts.error.stack) lines.push('', '### stack', '```', opts.error.stack, '```');
  return lines.join('\n');
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function runAction<T>(opts: ActionToastOpts<T>): Promise<T | null> {
  const toastOpts: ExternalToast = { description: opts.description };
  const id = toast.loading(opts.title, toastOpts);

  try {
    const result = await opts.fn();

    if (isServerActionResult(result) && result.ok === false) {
      throw new Error(result.error || 'Action failed');
    }

    const successTitle =
      typeof opts.successTitle === 'function'
        ? opts.successTitle(result)
        : (opts.successTitle ?? `${opts.title} ✓`);
    const successDescription =
      typeof opts.successDescription === 'function'
        ? opts.successDescription(result)
        : opts.successDescription;

    toast.success(successTitle, { id, description: successDescription });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const report = buildReport({
      title: opts.title,
      scope: opts.scope,
      error,
      extras: opts.extras,
    });
    toast.error(opts.errorTitle ?? `${opts.title} failed`, {
      id,
      description: error.message || 'An unknown error occurred.',
      duration: 12_000,
      action: {
        label: 'Copy details',
        onClick: async () => {
          const ok = await copyToClipboard(report);
          if (ok) toast.success('Error details copied — paste into chat.');
          else toast.error('Could not copy. Open DevTools console.');
        },
      },
    });
    if (typeof window !== 'undefined') {
      // Always log to console so the user can copy from there as a fallback.
      console.error(`[action:${opts.scope ?? opts.title}]`, error, opts.extras);
    }
    return null;
  }
}

/** Passive system toasts — no progress, no copy button. */
export const notify = {
  info: (title: string, description?: string) =>
    toast(title, description ? { description } : undefined),
  success: (title: string, description?: string) =>
    toast.success(title, description ? { description } : undefined),
  warning: (title: string, description?: string) =>
    toast.warning(title, description ? { description } : undefined),
  error: (title: string, description?: string) =>
    toast.error(title, description ? { description } : undefined),
};
