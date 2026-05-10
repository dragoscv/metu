'use client';
import { useState, useTransition } from 'react';
import { Card, CardTitle } from '@metu/ui';
import {
  clearToolAclAction,
  setToolAclAction,
  updateAutonomyPolicyAction,
} from '@/app/actions/autonomy';

export type AutonomyMode = 'observe' | 'ask' | 'auto_with_undo' | 'autopilot';

const MODE_LABELS: Record<AutonomyMode, string> = {
  observe: 'Observe',
  ask: 'Ask',
  auto_with_undo: 'Auto + undo',
  autopilot: 'Autopilot',
};

const MODE_DESCRIPTIONS: Record<AutonomyMode, string> = {
  observe: 'Never act; only suggest in chat.',
  ask: 'Draft actions; require one tap to approve.',
  auto_with_undo: 'Act autonomously; show an undo button.',
  autopilot: 'Trust fully (within caps).',
};

export interface ToolRow {
  name: string;
  description: string;
  kind: 'read' | 'low_risk' | 'high_risk';
  effective: AutonomyMode;
  override: AutonomyMode | null;
  scopable?: boolean;
  costWarning?: {
    baselineMode: 'ask' | 'auto_with_undo';
    multiplier: number;
    autopilotAvg: number;
    baselineAvg: number;
    autopilotCalls: number;
    baselineCalls: number;
  } | null;
}

export interface ScopedAclRow {
  tool: string;
  integrationId: string;
  integrationLabel: string;
  integrationKind: string;
  integrationStatus: string;
  effective: AutonomyMode;
  override: AutonomyMode | null;
  /** Same shape as ToolRow.costWarning — computed at workspace level. */
  costWarning?: ToolRow['costWarning'];
}

export interface PolicyState {
  defaultMode: AutonomyMode;
  enabled: boolean;
  notificationLevel: number;
  dailyCostCapUsd: number | null;
  dailyActionCap: number | null;
  tickIntervalSec: number;
  unlimitedAi: boolean;
}

export function AutonomyForm({
  initial,
  tools,
  scopedRows = [],
}: {
  initial: PolicyState;
  tools: ToolRow[];
  scopedRows?: ScopedAclRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PolicyState>(initial);

  function save(patch: Partial<PolicyState>) {
    setState((s) => ({ ...s, ...patch }));
    startTransition(async () => {
      await updateAutonomyPolicyAction(patch);
    });
  }

  return (
    <div className="space-y-6">
      <Card data-card-variant={state.enabled ? undefined : 'outline'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{state.enabled ? 'Conductor is active' : 'Conductor is paused'}</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
              When paused, the supervisor tick exits without planning or running tools. Captures,
              webhooks, and SDK observe events still flow in but no autonomous actions fire.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={state.enabled}
            disabled={pending}
            onClick={() => save({ enabled: !state.enabled })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              state.enabled ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border-strong)]'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                state.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </Card>

      <Card>
        <CardTitle>Default autonomy</CardTitle>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          The level the Conductor applies to any tool that doesn&apos;t have its own override.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {(Object.keys(MODE_LABELS) as AutonomyMode[]).map((m) => (
            <button
              key={m}
              type="button"
              disabled={pending}
              onClick={() => save({ defaultMode: m })}
              className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                state.defaultMode === m
                  ? 'border-[var(--color-brand)] bg-[var(--color-bg-card)]'
                  : 'border-[var(--color-border)] hover:bg-[var(--color-bg-elevated)]'
              }`}
            >
              <div className="text-sm font-medium">{MODE_LABELS[m]}</div>
              <div className="mt-0.5 text-[11px] text-[var(--color-fg-muted)]">
                {MODE_DESCRIPTIONS[m]}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Notification level</CardTitle>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          0 = silent · 50 = ambient · 100 = assertive. The Conductor adapts how often and how loudly
          it interrupts you.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={state.notificationLevel}
            onChange={(e) => save({ notificationLevel: Number(e.target.value) })}
            className="flex-1 accent-[var(--color-brand)]"
            disabled={pending}
          />
          <span className="w-10 text-right text-sm">{state.notificationLevel}</span>
        </div>
      </Card>

      <Card>
        <CardTitle>Budget</CardTitle>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field
            label="Daily cost cap (USD)"
            value={state.dailyCostCapUsd ?? ''}
            type="number"
            placeholder="2"
            disabled={state.unlimitedAi || pending}
            onChange={(v) => save({ dailyCostCapUsd: v === '' ? null : Number(v) })}
          />
          <Field
            label="Daily action cap"
            value={state.dailyActionCap ?? ''}
            type="number"
            placeholder="50"
            disabled={pending}
            onChange={(v) => save({ dailyActionCap: v === '' ? null : Number(v) })}
          />
          <Field
            label="Tick interval (sec)"
            value={state.tickIntervalSec}
            type="number"
            placeholder="300"
            disabled={pending}
            onChange={(v) => save({ tickIntervalSec: Number(v || 300) })}
          />
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.unlimitedAi}
            onChange={(e) => save({ unlimitedAi: e.target.checked })}
            disabled={pending}
          />
          Unlimited AI — disable cost caps. Only enable if you really mean it.
        </label>
      </Card>

      <Card>
        <CardTitle>Per-tool overrides</CardTitle>
        <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
          Override the default for a specific tool. Read-only tools always run.
        </p>
        <ol className="mt-3 divide-y divide-[var(--color-border)]">
          {tools.map((t) => (
            <ToolRowCmp key={t.name} t={t} pending={pending} />
          ))}
        </ol>
      </Card>

      {scopedRows.length > 0 && (
        <Card>
          <CardTitle>Per-integration overrides</CardTitle>
          <p className="mt-1 text-xs text-[var(--color-fg-subtle)]">
            Fine-tune autonomy for one specific connected integration. Most specific rule wins:
            integration-scoped beats tool-wide override beats workspace default.
          </p>
          <ol className="mt-3 divide-y divide-[var(--color-border)]">
            {scopedRows.map((r) => (
              <ScopedRowCmp key={`${r.tool}::${r.integrationId}`} r={r} pending={pending} />
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function ScopedRowCmp({ r, pending }: { r: ScopedAclRow; pending: boolean }) {
  const [, startTransition] = useTransition();
  const showWarning = r.costWarning && (r.effective === 'autopilot' || r.override === 'autopilot');
  return (
    <li className="flex flex-wrap items-start gap-3 py-2.5">
      <div className="min-w-[260px] flex-1">
        <div className="text-sm font-medium">{r.integrationLabel}</div>
        <div className="text-xs text-[var(--color-fg-subtle)]">
          <span className="font-mono">{r.tool}</span> · {r.integrationKind} · {r.integrationStatus}
        </div>
        {showWarning && r.costWarning ? (
          <CostWarning
            warning={r.costWarning}
            onDowngrade={() => {
              startTransition(async () => {
                await setToolAclAction({
                  tool: r.tool,
                  mode: r.costWarning!.baselineMode,
                  integrationId: r.integrationId,
                  source: 'cost_warning_downgrade',
                });
              });
            }}
            pending={pending}
          />
        ) : null}
      </div>
      <select
        defaultValue={r.override ?? ''}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value as AutonomyMode | '';
          startTransition(async () => {
            if (v === '')
              await clearToolAclAction({ tool: r.tool, integrationId: r.integrationId });
            else
              await setToolAclAction({
                tool: r.tool,
                mode: v,
                integrationId: r.integrationId,
              });
          });
        }}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs"
      >
        <option value="">inherit ({r.effective})</option>
        {(Object.keys(MODE_LABELS) as AutonomyMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </li>
  );
}

function ToolRowCmp({ t, pending }: { t: ToolRow; pending: boolean }) {
  const [, startTransition] = useTransition();
  const showWarning = t.costWarning && (t.effective === 'autopilot' || t.override === 'autopilot');
  return (
    <li className="flex flex-wrap items-start gap-3 py-2.5">
      <div className="min-w-[260px] flex-1">
        <div className="font-mono text-sm">{t.name}</div>
        <div className="text-xs text-[var(--color-fg-subtle)]">
          {t.kind} · {t.description}
        </div>
        {showWarning && t.costWarning ? (
          <CostWarning
            warning={t.costWarning}
            onDowngrade={() => {
              startTransition(async () => {
                await setToolAclAction({
                  tool: t.name,
                  mode: t.costWarning!.baselineMode,
                  source: 'cost_warning_downgrade',
                });
              });
            }}
            pending={pending}
          />
        ) : null}
      </div>
      <select
        defaultValue={t.override ?? ''}
        disabled={pending || t.kind === 'read'}
        onChange={(e) => {
          const v = e.target.value as AutonomyMode | '';
          startTransition(async () => {
            if (v === '') await clearToolAclAction(t.name);
            else await setToolAclAction({ tool: t.name, mode: v });
          });
        }}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs"
      >
        <option value="">inherit ({t.effective})</option>
        {(Object.keys(MODE_LABELS) as AutonomyMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </select>
    </li>
  );
}

function CostWarning({
  warning,
  onDowngrade,
  pending,
}: {
  warning: NonNullable<ToolRow['costWarning']>;
  onDowngrade: () => void;
  pending: boolean;
}) {
  return (
    <div className="border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 mt-1.5 flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] text-[var(--color-warning)]">
      <span>⚠</span>
      <span className="text-[var(--color-fg)]">
        Autopilot avg <span className="font-mono">${warning.autopilotAvg.toFixed(4)}</span> ·{' '}
        {warning.autopilotCalls} call{warning.autopilotCalls === 1 ? '' : 's'}
        {' — '}
        <span className="font-semibold">{warning.multiplier.toFixed(1)}×</span> the{' '}
        {MODE_LABELS[warning.baselineMode]} avg of{' '}
        <span className="font-mono">${warning.baselineAvg.toFixed(4)}</span>
        {' over '}
        {warning.baselineCalls} call{warning.baselineCalls === 1 ? '' : 's'}.
      </span>
      <button
        type="button"
        onClick={onDowngrade}
        disabled={pending}
        className="hover:bg-[var(--color-warning)]/10 ml-auto rounded border border-current px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
      >
        Switch to {MODE_LABELS[warning.baselineMode]}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  type,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: string | number;
  type: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--color-fg-muted)]">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-fg)] disabled:opacity-50"
      />
    </label>
  );
}
