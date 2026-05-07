'use client';
import { useState, useTransition } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  Github,
  Loader2,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  CardValue,
  EmptyState,
  PageHeader,
  StatusDot,
} from '@metu/ui';
import {
  kickConductorAction,
  reindexGithubRepoAction,
  type AgentActivityRow,
  type MetuOverview,
} from '@/app/actions/metu';
import { approveToolCallAction, rejectToolCallAction } from '@/app/actions/conductor';
import { updateAutonomyPolicyAction } from '@/app/actions/autonomy';
import { runAction } from '@/lib/action-toast';

const EASE = [0.22, 1, 0.36, 1] as const;

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function statusVariant(status: string): React.ComponentProps<typeof Badge>['variant'] {
  switch (status) {
    case 'success':
    case 'approved':
      return 'success';
    case 'failed':
      return 'danger';
    case 'awaiting_approval':
    case 'pending':
      return 'warning';
    case 'running':
      return 'info';
    case 'rejected':
    case 'cancelled':
      return 'neutral';
    case 'undone':
      return 'outline';
    default:
      return 'neutral';
  }
}

export function MetuDashboard({
  overview,
  activity,
}: {
  overview: MetuOverview;
  activity: AgentActivityRow[];
}) {
  const { status, stats, pulse, pending, toolMix, integrationsCount, projectsCount, repos } =
    overview;
  const router = useRouter();
  const [pendingTransition, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(status.enabled);
  const [reindexing, setReindexing] = useState<Record<string, 'queued' | 'done' | 'failed'>>({});

  const successRate =
    stats.toolCalls > 0 ? Math.round((stats.succeeded / stats.toolCalls) * 100) : null;

  function handleKick() {
    startTransition(async () => {
      await runAction({
        title: 'Waking conductor',
        description: 'Sending a manual tick — METU will plan and act shortly.',
        successTitle: 'Conductor woken',
        successDescription: 'Watch the activity feed for the next pulse.',
        scope: 'kickConductorAction',
        fn: () => kickConductorAction(),
      });
      router.refresh();
    });
  }

  function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const r = await runAction({
        title: next ? 'Resuming autonomy' : 'Pausing autonomy',
        description: next
          ? 'METU will resume continuous ticks immediately.'
          : 'METU will skip planning until you resume.',
        successTitle: next ? 'Autonomy resumed' : 'Autonomy paused',
        scope: 'updateAutonomyPolicyAction',
        extras: { enabled: next },
        fn: () => updateAutonomyPolicyAction({ enabled: next }),
      });
      if (!r) setEnabled(!next);
      else router.refresh();
    });
  }

  function handleApprove(id: string, tool: string) {
    startTransition(async () => {
      await runAction({
        title: `Approving ${tool}`,
        description: 'Running the tool with your authorization.',
        successTitle: `${tool} approved`,
        successDescription: 'Tool ran — see the activity feed for the result.',
        scope: 'approveToolCallAction',
        extras: { toolCallId: id, tool },
        fn: () => approveToolCallAction(id),
      });
      router.refresh();
    });
  }

  function handleReject(id: string, tool: string) {
    startTransition(async () => {
      await runAction({
        title: `Rejecting ${tool}`,
        successTitle: `${tool} rejected`,
        scope: 'rejectToolCallAction',
        extras: { toolCallId: id, tool },
        fn: () => rejectToolCallAction(id),
      });
      router.refresh();
    });
  }

  function handleReindex(repo: MetuOverview['repos'][number]) {
    const key = repo.projectId + ':' + repo.repoFullName;
    setReindexing((s) => ({ ...s, [key]: 'queued' }));
    startTransition(async () => {
      const r = await runAction({
        title: `Re-indexing ${repo.repoFullName}`,
        description: 'Pulling README, recent commits, and open issues into memory.',
        successTitle: 'Re-index queued',
        successDescription:
          'METU is reading the repo in the background. Counts will update when it finishes.',
        scope: 'reindexGithubRepoAction',
        extras: {
          projectId: repo.projectId,
          repoFullName: repo.repoFullName,
          integrationId: repo.integrationId,
        },
        fn: () =>
          reindexGithubRepoAction({
            projectId: repo.projectId,
            integrationId: repo.integrationId,
            repoFullName: repo.repoFullName,
            repoUrl: repo.url,
          }),
      });
      setReindexing((s) => ({ ...s, [key]: r ? 'done' : 'failed' }));
      // Inngest runs async — give it a moment, then refresh to pick up new chunks.
      if (r) setTimeout(() => router.refresh(), 4000);
    });
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-[var(--color-fg-muted)]">
            <Sparkles className="h-3.5 w-3.5" />
            Personal AI Operating System
          </span>
        }
        title="METU"
        description={
          enabled
            ? 'Always-on. Observing your work and acting within your autonomy policy.'
            : 'Paused. The agent is asleep until you resume autonomy.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={enabled ? 'subtle' : 'outline'}
              size="sm"
              onClick={handleToggle}
              disabled={pendingTransition}
            >
              {enabled ? (
                <>
                  <PauseCircle className="h-4 w-4" /> Pause
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" /> Resume
                </>
              )}
            </Button>
            <Button size="sm" onClick={handleKick} disabled={pendingTransition || !enabled}>
              <Zap className="h-4 w-4" /> Wake up
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.href = '/chat';
              }}
            >
              Open chat
            </Button>
          </div>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: EASE }}
        className="mt-6 flex flex-col gap-6"
      >
        {/* Status row */}
        <Card variant="glass" className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <div className="flex items-center gap-2.5">
            <StatusDot state={enabled ? 'success' : 'offline'} pulse={enabled} size="md" />
            <div>
              <div className="text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">
                Autonomy
              </div>
              <div className="text-sm font-medium">{enabled ? 'Active' : 'Paused'}</div>
            </div>
          </div>
          <Stat label="Mode" value={status.defaultMode.replace('_', ' ')} />
          <Stat label="Tick" value={`${Math.round(status.tickIntervalSec / 60)} min`} />
          <Stat
            label="Cost cap"
            value={
              status.dailyCostCapUsd != null
                ? `$${status.dailyCostCapUsd.toFixed(2)}/day`
                : 'unlimited'
            }
          />
          <Stat
            label="Action cap"
            value={status.dailyActionCap != null ? `${status.dailyActionCap}/day` : 'unlimited'}
          />
          <Stat
            label="Model"
            value={
              pulse?.model
                ? `${pulse.provider ?? '?'} / ${pulse.model.split('-').slice(0, 3).join('-')}`
                : 'auto-selected'
            }
          />
        </Card>

        {/* Stats grid */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="Tool calls (24h)"
            value={stats.toolCalls}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Success rate"
            value={successRate != null ? `${successRate}%` : '—'}
            tone={successRate != null && successRate >= 80 ? 'good' : undefined}
          />
          <StatCard
            icon={<DollarSign className="h-4 w-4" />}
            label="Spent today"
            value={`$${stats.costUsd.toFixed(3)}`}
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Pending approval"
            value={stats.pendingApproval}
            tone={stats.pendingApproval > 0 ? 'warn' : undefined}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Pulse */}
          <Card className="p-5 lg:col-span-2">
            <div className="mb-2 flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--color-fg-muted)]" />
              <CardTitle>What I&apos;m thinking</CardTitle>
              {pulse?.actionCount ? (
                <Badge variant="info" size="xs">
                  {pulse.actionCount} action{pulse.actionCount === 1 ? '' : 's'}
                </Badge>
              ) : null}
              {pulse ? (
                <span className="ml-auto text-xs text-[var(--color-fg-subtle)]">
                  {relativeTime(pulse.createdAt)}
                </span>
              ) : null}
            </div>
            {pulse ? (
              <p className="text-[var(--color-fg)]/90 whitespace-pre-wrap text-sm leading-relaxed">
                {pulse.content}
              </p>
            ) : (
              <p className="text-sm text-[var(--color-fg-muted)]">
                No pulse yet. Hit &ldquo;Wake up&rdquo; to start the first tick.
              </p>
            )}
          </Card>

          {/* Pending approvals */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--color-fg-muted)]" />
              <CardTitle>Awaiting approval</CardTitle>
              {pending.length > 0 && (
                <Badge variant="warning" size="xs" className="ml-auto">
                  {pending.length}
                </Badge>
              )}
            </div>
            {pending.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)]">No pending actions.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="bg-[var(--color-bg-card)]/40 rounded-md border border-[var(--color-border)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-medium">{p.tool}</code>
                      <span className="ml-auto text-[10px] text-[var(--color-fg-subtle)]">
                        {relativeTime(p.requestedAt)}
                      </span>
                    </div>
                    <pre className="mt-1.5 max-h-20 overflow-hidden text-[11px] leading-snug text-[var(--color-fg-muted)]">
                      {JSON.stringify(p.args, null, 2).slice(0, 240)}
                    </pre>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(p.id, p.tool)}
                        disabled={pendingTransition}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReject(p.id, p.tool)}
                        disabled={pendingTransition}
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Recent activity */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--color-fg-muted)]" />
            <CardTitle>Recent actions</CardTitle>
            <span className="ml-auto text-xs text-[var(--color-fg-subtle)]">
              {activity.length} entries
            </span>
          </div>
          {activity.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Activity className="h-5 w-5" />}
              title="No actions yet"
              description="Once the conductor runs a tool, you'll see it here."
            />
          ) : (
            <ol className="flex flex-col gap-1.5">
              {activity.map((a) => (
                <li
                  key={a.id}
                  className="hover:bg-[var(--color-bg-card)]/60 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm"
                >
                  <Badge variant={statusVariant(a.status)} size="xs">
                    {a.status}
                  </Badge>
                  <code className="text-xs font-medium">{a.tool}</code>
                  {a.aclMode && (
                    <span className="text-[10px] text-[var(--color-fg-subtle)]">{a.aclMode}</span>
                  )}
                  <span className="ml-auto text-xs text-[var(--color-fg-muted)]">
                    {relativeTime(a.requestedAt)}
                  </span>
                  {a.conversationId && (
                    <Link
                      href={`/chat?id=${a.conversationId}&toolCall=${a.id}`}
                      className="text-xs text-[var(--color-fg-muted)] underline-offset-2 hover:text-[var(--color-fg)] hover:underline"
                    >
                      open
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Tool mix + footer */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex items-center gap-2">
              <Cpu className="h-4 w-4 text-[var(--color-fg-muted)]" />
              <CardTitle>Tool mix (24h)</CardTitle>
            </div>
            {toolMix.length === 0 ? (
              <p className="text-sm text-[var(--color-fg-muted)]">No tool usage yet.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {toolMix.map((t) => {
                  const max = toolMix[0]!.total;
                  const pct = max > 0 ? Math.round((t.total / max) * 100) : 0;
                  return (
                    <li key={t.tool} className="flex items-center gap-3">
                      <code className="w-48 truncate text-xs">{t.tool}</code>
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg-card)]">
                        <div
                          className="absolute inset-y-0 left-0 bg-[var(--color-brand)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-[var(--color-fg-muted)]">
                        {t.total}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card className="p-5">
            <CardTitle className="mb-3">Workspace</CardTitle>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Projects" value={projectsCount} />
              <Row label="Active integrations" value={integrationsCount} />
              <Row label="Indexed repos" value={repos.length} />
            </dl>
          </Card>
        </div>

        {/* Project intelligence */}
        {repos.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <Github className="h-4 w-4 text-[var(--color-fg-muted)]" />
              <CardTitle>Project intelligence</CardTitle>
              <CardDescription className="ml-auto">Repos METU has read for memory</CardDescription>
            </div>
            <ol className="flex flex-col gap-2">
              {repos.map((r) => {
                const key = r.projectId + ':' + r.repoFullName;
                const state = reindexing[key];
                return (
                  <li
                    key={key}
                    className="bg-[var(--color-bg-card)]/30 flex items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
                  >
                    <Github className="h-4 w-4 text-[var(--color-fg-subtle)]" />
                    <Link href={`/projects/${r.projectId}`} className="text-sm hover:underline">
                      {r.projectName}
                    </Link>
                    <span className="text-xs text-[var(--color-fg-subtle)]">{r.repoFullName}</span>
                    {state === 'queued' && (
                      <Badge size="xs" variant="info" className="ml-auto">
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> indexing
                      </Badge>
                    )}
                    {state === 'done' && (
                      <Badge size="xs" variant="success" className="ml-auto">
                        queued
                      </Badge>
                    )}
                    {state === 'failed' && (
                      <Badge size="xs" variant="danger" className="ml-auto">
                        failed
                      </Badge>
                    )}
                    {!state && (
                      <Badge
                        size="xs"
                        variant={r.chunkCount > 0 ? 'success' : 'neutral'}
                        className="ml-auto"
                      >
                        {r.chunkCount} memories
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReindex(r)}
                      disabled={pendingTransition || state === 'queued'}
                    >
                      {state === 'queued' ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working
                        </>
                      ) : (
                        'Re-index'
                      )}
                    </Button>
                  </li>
                );
              })}
            </ol>
          </Card>
        )}
      </motion.div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--color-fg-muted)]">{label}</div>
      <div className="text-sm font-medium capitalize">{value}</div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'good' | 'warn';
}) {
  return (
    <Card variant="elevated" className="p-4">
      <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-fg-muted)]">
        {icon}
        <span>{label}</span>
      </div>
      <CardValue
        className={
          tone === 'good'
            ? 'text-[var(--color-success)]'
            : tone === 'warn'
              ? 'text-[var(--color-warning)]'
              : ''
        }
      >
        {value}
      </CardValue>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <dt className="text-[var(--color-fg-muted)]">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
