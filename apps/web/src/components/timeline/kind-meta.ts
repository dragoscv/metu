import {
  Brain,
  Briefcase,
  CheckCircle2,
  CreditCard,
  FileText,
  GitBranch,
  Inbox,
  Key,
  Lightbulb,
  MegaphoneOff,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import type { ComponentType } from 'react';

interface KindMeta {
  label: string;
  icon: ComponentType<{ className?: string }>;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
  group: string;
}

const META: Record<string, KindMeta> = {
  'capture.created': { label: 'Capture', icon: Inbox, tone: 'info', group: 'capture' },
  'capture.assigned': { label: 'Capture assigned', icon: Inbox, tone: 'info', group: 'capture' },
  'memory.indexed': { label: 'Memory indexed', icon: Brain, tone: 'neutral', group: 'memory' },
  'conversation.imported': { label: 'Import', icon: MessageSquare, tone: 'info', group: 'capture' },
  'project.created': {
    label: 'Project created',
    icon: Briefcase,
    tone: 'success',
    group: 'project',
  },
  'project.updated': {
    label: 'Project updated',
    icon: Briefcase,
    tone: 'neutral',
    group: 'project',
  },
  'project.archived': {
    label: 'Project archived',
    icon: Briefcase,
    tone: 'warning',
    group: 'project',
  },
  'decision.logged': { label: 'Decision', icon: Lightbulb, tone: 'brand', group: 'project' },
  'task.completed': { label: 'Task done', icon: CheckCircle2, tone: 'success', group: 'project' },
  'task.created': { label: 'Task added', icon: CheckCircle2, tone: 'neutral', group: 'project' },
  'goal.created': { label: 'Goal created', icon: Target, tone: 'success', group: 'goal' },
  'goal.checkin': { label: 'Goal check-in', icon: TrendingUp, tone: 'info', group: 'goal' },
  'target.value': { label: 'Target value', icon: TrendingUp, tone: 'info', group: 'goal' },
  'conductor.observation': { label: 'Conductor', icon: Sparkles, tone: 'brand', group: 'system' },
  'conductor.escalation.completed': {
    label: 'Escalation done',
    icon: MegaphoneOff,
    tone: 'success',
    group: 'system',
  },
  'intent.received': { label: 'Intent', icon: Zap, tone: 'warning', group: 'system' },
  'creds.borrowed': { label: 'Creds borrowed', icon: Key, tone: 'warning', group: 'system' },
  'subscription.activated': {
    label: 'Subscription activated',
    icon: CreditCard,
    tone: 'success',
    group: 'billing',
  },
  'subscription.updated': {
    label: 'Subscription updated',
    icon: CreditCard,
    tone: 'info',
    group: 'billing',
  },
  'subscription.canceled': {
    label: 'Subscription canceled',
    icon: CreditCard,
    tone: 'warning',
    group: 'billing',
  },
};

const FALLBACK: KindMeta = { label: 'Event', icon: FileText, tone: 'neutral', group: 'other' };
const GIT: KindMeta = { label: 'Git', icon: GitBranch, tone: 'info', group: 'integration' };

export function kindMeta(kind: string): KindMeta {
  if (META[kind]) return META[kind]!;
  if (kind.startsWith('git.') || kind.startsWith('github.')) return GIT;
  // Fallback by prefix
  const prefix = kind.split('.')[0];
  if (prefix === 'capture') return META['capture.created']!;
  if (prefix === 'project') return META['project.updated']!;
  if (prefix === 'task') return META['task.created']!;
  if (prefix === 'goal') return META['goal.created']!;
  if (prefix === 'target') return META['target.value']!;
  if (prefix === 'conductor') return META['conductor.observation']!;
  if (prefix === 'subscription') return META['subscription.updated']!;
  return FALLBACK;
}

export function resolveSourceLink(
  kind: string,
  payload: Record<string, unknown> | null | undefined,
  projectId: string | null,
): string | null {
  const p = (payload ?? {}) as Record<string, string | undefined>;
  if (kind.startsWith('capture.')) {
    return p.captureId ? `/inbox/${p.captureId}` : '/inbox';
  }
  if (kind === 'decision.logged') {
    if (p.decisionId && projectId) return `/projects/${projectId}/decisions/${p.decisionId}`;
    if (projectId) return `/projects/${projectId}`;
    return null;
  }
  if (kind.startsWith('task.')) {
    if (p.taskId && projectId) return `/projects/${projectId}/tasks/${p.taskId}`;
    if (projectId) return `/projects/${projectId}`;
    return null;
  }
  if (kind.startsWith('project.') && projectId) return `/projects/${projectId}`;
  if (kind.startsWith('goal.')) return p.goalId ? `/goals/${p.goalId}` : '/goals';
  if (kind.startsWith('target.'))
    return p.targetId ? `/goals/targets/${p.targetId}` : '/goals#targets';
  if (kind === 'conversation.imported') return '/inbox';
  return null;
}
