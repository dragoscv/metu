/**
 * Shared chrome for the Memory page — source-kind metadata + helpers.
 */
import {
  Brain,
  CheckSquare,
  GitCommit,
  GitMerge,
  Hash,
  Mail,
  MessageSquare,
  Notebook,
  PenLine,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export const SOURCE_KINDS = [
  'capture',
  'task',
  'decision',
  'project_summary',
  'repo_file',
  'commit',
  'email',
  'message',
  'agent_run',
  'manual',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_META: Record<
  SourceKind,
  { label: string; icon: LucideIcon; tone: 'brand' | 'info' | 'success' | 'warning' | 'neutral' }
> = {
  capture: { label: 'Capture', icon: PenLine, tone: 'brand' },
  task: { label: 'Task', icon: CheckSquare, tone: 'info' },
  decision: { label: 'Decision', icon: GitMerge, tone: 'success' },
  project_summary: { label: 'Project', icon: Notebook, tone: 'info' },
  repo_file: { label: 'Code', icon: Hash, tone: 'neutral' },
  commit: { label: 'Commit', icon: GitCommit, tone: 'neutral' },
  email: { label: 'Email', icon: Mail, tone: 'warning' },
  message: { label: 'Message', icon: MessageSquare, tone: 'warning' },
  agent_run: { label: 'Agent', icon: Sparkles, tone: 'brand' },
  manual: { label: 'Note', icon: Brain, tone: 'neutral' },
};

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
