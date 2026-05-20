/**
 * Pure helpers for /journal. Extracted so they can be unit-tested
 * without rendering the RSC page.
 */

export const JOURNAL_RANGES = [
  { key: '7d' as const, label: 'Last 7 days', days: 7 },
  { key: '30d' as const, label: 'Last 30 days', days: 30 },
  { key: '90d' as const, label: 'Last 90 days', days: 90 },
];

export type JournalRangeKey = (typeof JOURNAL_RANGES)[number]['key'];

export function parseJournalRange(s: string | undefined): JournalRangeKey {
  if (s === '7d' || s === '30d' || s === '90d') return s;
  return '7d';
}

export type JournalTone = 'neutral' | 'success' | 'warning';

export const JOURNAL_KIND_LABELS: Record<string, { label: string; tone: JournalTone }> = {
  'capture.created': { label: 'Capture', tone: 'neutral' },
  'project.created': { label: 'Project', tone: 'success' },
  'project.updated': { label: 'Project', tone: 'neutral' },
  'project.archived': { label: 'Archive', tone: 'warning' },
  'decision.logged': { label: 'Decision', tone: 'success' },
  'task.created': { label: 'Task', tone: 'neutral' },
  'task.completed': { label: 'Done', tone: 'success' },
  'focus.recomputed': { label: 'Focus', tone: 'neutral' },
  'integration.connected': { label: 'Integration', tone: 'success' },
  'conductor.tick': { label: 'Conductor', tone: 'neutral' },
  'conductor.action': { label: 'Conductor', tone: 'success' },
  'notification.sent': { label: 'Notify', tone: 'neutral' },
};

export function labelForKind(kind: string): { label: string; tone: JournalTone } {
  return (
    JOURNAL_KIND_LABELS[kind] ?? {
      label: kind.split('.')[0] ?? kind,
      tone: 'neutral',
    }
  );
}
