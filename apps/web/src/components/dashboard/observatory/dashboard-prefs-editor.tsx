'use client';
/**
 * DashboardPrefsEditor — client wrapper that renders the form alongside
 * a live preview of the observatory using deterministic mock streams.
 *
 * The preview is "live" for the visual prefs (skin / motionMode /
 * actionSurface / showSessionAnchor / manualReducedMotion). Category +
 * valence overrides aren't reflected until save (preview uses mock data
 * that doesn't depend on real categories).
 */
import { useState } from 'react';
import type {
  ActionSurface,
  DashboardPrefs,
  HeartbeatSkin,
  Mood,
  MotionMode,
  StreamItem,
} from '@/lib/dashboard/types';
import { DashboardPrefsForm } from './dashboard-prefs-form';
import { DashboardScene } from './dashboard-scene';

const MOCK_STREAMS: StreamItem[] = [
  {
    id: 'preview:goal-1',
    category: 'goals',
    valence: 'streak',
    label: 'Walk daily',
    sublabel: 'last check-in',
    anchorAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    href: '#',
  },
  {
    id: 'preview:goal-2',
    category: 'goals',
    valence: 'streak',
    label: 'No smoking',
    sublabel: '12 day streak',
    anchorAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
    href: '#',
  },
  {
    id: 'preview:capture',
    category: 'captures',
    valence: 'pulse',
    label: 'Last capture',
    sublabel: 'inbox',
    anchorAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    href: '#',
  },
  {
    id: 'preview:project-active',
    category: 'project_activity',
    valence: 'pulse',
    label: 'metu observatory',
    anchorAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    href: '#',
  },
  {
    id: 'preview:integration',
    category: 'integrations',
    valence: 'pulse',
    label: 'GitHub',
    sublabel: 'github',
    anchorAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    href: '#',
  },
  {
    id: 'preview:project-old',
    category: 'project_age',
    valence: 'drift',
    label: 'Old idea',
    sublabel: 'idea waiting',
    anchorAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 22).toISOString(),
    href: '#',
  },
  {
    id: 'preview:task',
    category: 'tasks',
    valence: 'drift',
    label: 'Reply to email',
    sublabel: 'open',
    anchorAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
  },
  {
    id: 'preview:social',
    category: 'social_posts',
    valence: 'drift',
    label: 'Instagram',
    sublabel: 'instagram · last seen',
    anchorAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
    href: '#',
  },
];

export function DashboardPrefsEditor({ initial }: { initial: DashboardPrefs }) {
  // Live preview state — mirrors a subset of the form for instant feedback.
  const [skin, setSkin] = useState<HeartbeatSkin>(initial.skin);
  const [mood, setMood] = useState<Mood>(initial.mood);
  const [motionMode, setMotionMode] = useState<MotionMode>(initial.motionMode);
  const [actionSurface, setActionSurface] = useState<ActionSurface>(initial.actionSurface);
  const [showSessionAnchor, setShowSessionAnchor] = useState(initial.showSessionAnchor);
  const [manualReducedMotion, setManualReducedMotion] = useState(initial.manualReducedMotion);
  const [soundEnabled, setSoundEnabled] = useState(initial.soundEnabled);

  const previewPrefs: DashboardPrefs = {
    ...initial,
    skin,
    mood,
    motionMode,
    actionSurface,
    showSessionAnchor,
    manualReducedMotion,
    soundEnabled,
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div
        onChange={(e) =>
          syncFromForm(e, {
            setSkin,
            setMood,
            setMotionMode,
            setActionSurface,
            setShowSessionAnchor,
            setManualReducedMotion,
            setSoundEnabled,
          })
        }
      >
        <DashboardPrefsForm initial={initial} />
      </div>
      <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <div className="text-xs uppercase tracking-wider text-[var(--color-fg-subtle)]">
          live preview
        </div>
        <DashboardScene prefs={previewPrefs} streams={MOCK_STREAMS} greetingName="you" />
        <p className="text-[11px] text-[var(--color-fg-subtle)]">
          Skin, motion, action surface, anchor and reduced-motion update instantly. Category and
          valence overrides apply after save.
        </p>
      </aside>
    </div>
  );
}

/**
 * Cheap delegation: listen for change events bubbling out of the form
 * and mirror the relevant inputs into preview state. Avoids forking
 * the form's controlled-input model.
 */
function syncFromForm(
  e: React.FormEvent<HTMLDivElement>,
  setters: {
    setSkin: (v: HeartbeatSkin) => void;
    setMood: (v: Mood) => void;
    setMotionMode: (v: MotionMode) => void;
    setActionSurface: (v: ActionSurface) => void;
    setShowSessionAnchor: (v: boolean) => void;
    setManualReducedMotion: (v: boolean) => void;
    setSoundEnabled: (v: boolean) => void;
  },
) {
  const target = e.target as HTMLInputElement;
  if (!target?.name) return;
  if (target.name === 'skin' && target.checked) setters.setSkin(target.value as HeartbeatSkin);
  else if (target.name === 'mood' && target.checked) setters.setMood(target.value as Mood);
  else if (target.name === 'motionMode' && target.checked)
    setters.setMotionMode(target.value as MotionMode);
  else if (target.name === 'actionSurface' && target.checked)
    setters.setActionSurface(target.value as ActionSurface);
  else if (target.name === 'showSessionAnchor') setters.setShowSessionAnchor(target.checked);
  else if (target.name === 'manualReducedMotion') setters.setManualReducedMotion(target.checked);
  else if (target.name === 'soundEnabled') setters.setSoundEnabled(target.checked);
}
