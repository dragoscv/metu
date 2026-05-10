/**
 * Quiet-hours helper shared between the notify dispatcher and SDK
 * endpoints that surface the current "do not disturb" state to clients.
 */
export interface QuietHours {
  enabled?: boolean;
  start?: string;
  end?: string;
  tz?: string;
}

export function isQuietHoursActive(
  qh: QuietHours | Record<string, unknown> | null | undefined,
): boolean {
  if (!qh) return false;
  const enabled = (qh as QuietHours).enabled === true;
  const start = typeof (qh as QuietHours).start === 'string' ? (qh as QuietHours).start! : null;
  const end = typeof (qh as QuietHours).end === 'string' ? (qh as QuietHours).end! : null;
  const tz = typeof (qh as QuietHours).tz === 'string' ? (qh as QuietHours).tz! : 'UTC';
  if (!enabled || !start || !end) return false;
  let nowMin: number;
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    nowMin = hh * 60 + mm;
  } catch {
    return false;
  }
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const startMin = (sH ?? 0) * 60 + (sM ?? 0);
  const endMin = (eH ?? 0) * 60 + (eM ?? 0);
  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}
