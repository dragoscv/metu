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
}

export interface PolicyState {
  defaultMode: AutonomyMode;
  notificationLevel: number;
  dailyCostCapUsd: number | null;
  dailyActionCap: number | null;
  tickIntervalSec: number;
  unlimitedAi: boolean;
}

export function AutonomyForm({ initial, tools }: { initial: PolicyState; tools: ToolRow[] }) {
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
    </div>
  );
}

function ToolRowCmp({ t, pending }: { t: ToolRow; pending: boolean }) {
  const [, startTransition] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-[260px] flex-1">
        <div className="font-mono text-sm">{t.name}</div>
        <div className="text-xs text-[var(--color-fg-subtle)]">
          {t.kind} · {t.description}
        </div>
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
