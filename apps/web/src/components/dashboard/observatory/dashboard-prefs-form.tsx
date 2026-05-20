'use client';
/**
 * DashboardPrefsForm — client form to customize the observatory.
 *
 * Uses useActionState so the page stays simple. Posts the entire prefs
 * object (server merges with current/defaults).
 */
import { useActionState } from 'react';
import { Button } from '@metu/ui';
import { updateDashboardPrefsAction } from '@/app/actions/dashboard-prefs';
import {
  ACTION_SURFACES,
  HEARTBEAT_SKINS,
  MOODS,
  MOTION_MODES,
  STREAM_CATEGORIES,
  type DashboardPrefs,
  type DashboardPrefsInput,
  type Mood,
  type StreamCategory,
  type Valence,
} from '@/lib/dashboard/types';
import { HEARTBEAT_LABELS } from './heartbeats';

const MOOD_LABELS: Record<Mood, { name: string; tagline: string }> = {
  mystical: { name: 'Mystical', tagline: 'Deep night, soft cyan glow' },
  brutalist: { name: 'Brutalist', tagline: 'High-contrast paper-on-ink' },
  journal: { name: 'Journal', tagline: 'Warm parchment, ink lines' },
  cyberpunk: { name: 'Cyberpunk', tagline: 'Neon magenta + acid green' },
  forest: { name: 'Forest', tagline: 'Mossy greens, amber glow' },
};

const VALENCES: readonly Valence[] = ['streak', 'pulse', 'drift'];
const VALENCE_LABEL: Record<Valence, string> = {
  streak: 'streak (longer = better)',
  pulse: 'pulse (recent activity)',
  drift: 'drift (gentle reminder)',
};

const CATEGORY_DEFAULT_VALENCE: Record<StreamCategory, Valence> = {
  project_activity: 'pulse',
  project_age: 'drift',
  goals: 'streak',
  captures: 'pulse',
  tasks: 'drift',
  integrations: 'pulse',
  devices: 'pulse',
  social_posts: 'drift',
  people: 'pulse',
  decisions: 'pulse',
  health: 'streak',
};

const CATEGORY_LABELS: Record<(typeof STREAM_CATEGORIES)[number], string> = {
  project_activity: 'Project activity (recent touches)',
  project_age: 'Project age (ideas waiting)',
  goals: 'Goals (check-ins)',
  captures: 'Latest capture',
  tasks: 'Open tasks (drift)',
  integrations: 'Integration syncs',
  devices: 'Devices online',
  social_posts: 'Social posts (last seen)',
  people: 'People (recent mentions)',
  decisions: 'Decisions logged',
  health: 'Health & energy logs',
};

const ACTION_SURFACE_LABELS: Record<(typeof ACTION_SURFACES)[number], string> = {
  awareness: 'Awareness only — no actions',
  capture: 'Capture (default)',
  ring: 'Quick-action ring (long-press for radial)',
  console: 'Conductor console (inline reply box)',
};

interface ActionResult {
  ok: boolean;
  error?: string;
}

export function DashboardPrefsForm({ initial }: { initial: DashboardPrefs }) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(
    async (_prev, formData) => {
      const enabled = STREAM_CATEGORIES.filter((c) => formData.get(`cat:${c}`) === 'on');
      const valenceOverrides: Partial<Record<StreamCategory, Valence>> = {};
      for (const c of STREAM_CATEGORIES) {
        const raw = formData.get(`val:${c}`);
        if (typeof raw === 'string' && raw !== '' && raw !== CATEGORY_DEFAULT_VALENCE[c]) {
          if (raw === 'streak' || raw === 'pulse' || raw === 'drift') valenceOverrides[c] = raw;
        }
      }
      const input: DashboardPrefsInput = {
        skin: (formData.get('skin') as DashboardPrefs['skin']) ?? initial.skin,
        mood: (formData.get('mood') as Mood) ?? initial.mood,
        actionSurface:
          (formData.get('actionSurface') as DashboardPrefs['actionSurface']) ??
          initial.actionSurface,
        motionMode:
          (formData.get('motionMode') as DashboardPrefs['motionMode']) ?? initial.motionMode,
        enabledCategories: enabled,
        valenceOverrides: valenceOverrides as Record<StreamCategory, Valence>,
        staleAfterDays: Number(formData.get('staleAfterDays') ?? initial.staleAfterDays) || 0,
        showSessionAnchor: formData.get('showSessionAnchor') === 'on',
        manualReducedMotion: formData.get('manualReducedMotion') === 'on',
        soundEnabled: formData.get('soundEnabled') === 'on',
      };
      const res = await updateDashboardPrefsAction(input);
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    { ok: false },
  );

  return (
    <form action={formAction} className="space-y-8">
      {/* Mood — 5 looks × 5 skins = 25 combos */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Mood</legend>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          Re-skins the entire observatory. Pairs with any heartbeat skin below.
        </p>
        <div className="grid gap-2 sm:grid-cols-5">
          {MOODS.map((m) => {
            const meta = MOOD_LABELS[m];
            const checked = initial.mood === m;
            return (
              <label
                key={m}
                data-mood={m}
                className={[
                  'cursor-pointer rounded-xl border p-2.5 transition-colors',
                  checked
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="mood"
                  value={m}
                  defaultChecked={checked}
                  className="sr-only"
                />
                {/* Mood swatch — reads its own data-mood tokens */}
                <div
                  aria-hidden
                  className="mb-2 h-6 w-full rounded-md border border-[var(--color-border)]"
                  style={{
                    background:
                      'linear-gradient(135deg, var(--color-night-deep), color-mix(in oklch, var(--color-pulse) 50%, var(--color-night-deep)))',
                  }}
                />
                <div className="text-xs font-medium text-[var(--color-fg)]">{meta.name}</div>
                <div className="mt-0.5 text-[10px] text-[var(--color-fg-muted)]">
                  {meta.tagline}
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Heartbeat skin */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Heartbeat skin</legend>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          The metaphor for how your streams visualize. You can switch any time.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {HEARTBEAT_SKINS.map((s) => {
            const meta = HEARTBEAT_LABELS[s];
            const checked = initial.skin === s;
            return (
              <label
                key={s}
                className={[
                  'cursor-pointer rounded-xl border p-3 transition-colors',
                  checked
                    ? 'border-[var(--color-brand)] bg-[var(--color-brand-soft)]'
                    : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="skin"
                  value={s}
                  defaultChecked={checked}
                  className="sr-only"
                />
                <div className="text-sm font-medium text-[var(--color-fg)]">{meta.name}</div>
                <div className="mt-1 text-xs text-[var(--color-fg-muted)]">{meta.tagline}</div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Action surface */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Action surface</legend>
        <div className="space-y-1.5">
          {ACTION_SURFACES.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
              <input
                type="radio"
                name="actionSurface"
                value={a}
                defaultChecked={initial.actionSurface === a}
              />
              {ACTION_SURFACE_LABELS[a]}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Motion mode */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Motion</legend>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          &quot;Calm&quot; = no ambient animation. &quot;Alive&quot; = subtle breathing.
          Reduced-motion preference always wins.
        </p>
        <div className="flex gap-3">
          {MOTION_MODES.map((m) => (
            <label
              key={m}
              className={[
                'cursor-pointer rounded-full border px-3 py-1 text-xs uppercase tracking-wider transition-colors',
                initial.motionMode === m
                  ? 'border-[var(--color-brand)] text-[var(--color-fg)]'
                  : 'border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)]',
              ].join(' ')}
            >
              <input
                type="radio"
                name="motionMode"
                value={m}
                defaultChecked={initial.motionMode === m}
                className="sr-only"
              />
              {m}
            </label>
          ))}
        </div>
      </fieldset>

      {/* Streams */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Streams to surface</legend>
        <p className="text-xs text-[var(--color-fg-subtle)]">
          Pick what shows up, and how each category should feel — streak, pulse, or drift.
        </p>
        <div className="space-y-2">
          {STREAM_CATEGORIES.map((c) => {
            const currentVal = initial.valenceOverrides[c] ?? CATEGORY_DEFAULT_VALENCE[c];
            return (
              <div
                key={c}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
              >
                <label className="flex flex-1 items-center gap-2 text-sm text-[var(--color-fg-muted)]">
                  <input
                    type="checkbox"
                    name={`cat:${c}`}
                    defaultChecked={initial.enabledCategories.includes(c)}
                  />
                  {CATEGORY_LABELS[c]}
                </label>
                <select
                  name={`val:${c}`}
                  defaultValue={currentVal}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-xs text-[var(--color-fg)]"
                  aria-label={`Valence for ${CATEGORY_LABELS[c]}`}
                >
                  {VALENCES.map((v) => (
                    <option key={v} value={v}>
                      {VALENCE_LABEL[v]}
                      {v === CATEGORY_DEFAULT_VALENCE[c] ? ' · default' : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </fieldset>

      {/* Stale + session anchor */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-[var(--color-fg)]">Quietness</legend>
        <label className="flex items-center gap-3 text-sm text-[var(--color-fg-muted)]">
          Hide non-streak items older than
          <input
            type="number"
            name="staleAfterDays"
            min={0}
            max={365}
            defaultValue={initial.staleAfterDays}
            className="w-20 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-sm text-[var(--color-fg)]"
          />
          days <span className="text-xs text-[var(--color-fg-subtle)]">(0 = never hide)</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
          <input
            type="checkbox"
            name="showSessionAnchor"
            defaultChecked={initial.showSessionAnchor}
          />
          Show &quot;you opened metu X ago&quot; anchor
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
          <input
            type="checkbox"
            name="manualReducedMotion"
            defaultChecked={initial.manualReducedMotion}
          />
          Force reduced motion (in addition to OS setting)
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
          <input type="checkbox" name="soundEnabled" defaultChecked={initial.soundEnabled} />
          Ambient drone &amp; per-valence chimes{' '}
          <span className="text-xs text-[var(--color-fg-subtle)]">(off by default)</span>
        </label>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'saving…' : 'save preferences'}
        </Button>
        {state.ok && <span className="text-xs text-[var(--color-success)]">saved.</span>}
        {state.error && <span className="text-xs text-[var(--color-danger)]">{state.error}</span>}
      </div>
    </form>
  );
}
