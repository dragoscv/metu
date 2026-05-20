/**
 * Dashboard observatory — shared types + zod schema for dashboardPrefs.
 *
 * Persisted under `agent_policy.metadata.dashboardPrefs` (JSONB, no migration).
 * Same pattern as `mutedSources` / `digestEmail` in notification-prefs.
 */
import { z } from 'zod';

/** Visual metaphor for the heartbeat hero. New skins register here. */
export const HEARTBEAT_SKINS = [
  'constellation',
  'pulse-rings',
  'now-river',
  'garden',
  'card-stack',
] as const;
export type HeartbeatSkin = (typeof HEARTBEAT_SKINS)[number];

/** What sits below the heartbeat — pure awareness or with actions. */
export const ACTION_SURFACES = ['awareness', 'capture', 'ring', 'console'] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

/** Ambient motion budget. */
export const MOTION_MODES = ['calm', 'alive'] as const;
export type MotionMode = (typeof MOTION_MODES)[number];

/** Visual mood — re-skins all 5 heartbeat skins via CSS-var overrides. */
export const MOODS = ['mystical', 'brutalist', 'journal', 'cyberpunk', 'forest'] as const;
export type Mood = (typeof MOODS)[number];

/** Stream categories the user can toggle on/off. */
export const STREAM_CATEGORIES = [
  'project_activity',
  'project_age',
  'goals',
  'captures',
  'tasks',
  'integrations',
  'devices',
  'social_posts',
  'people',
  'decisions',
  'health',
] as const;
export type StreamCategory = (typeof STREAM_CATEGORIES)[number];

/** Three time-since polarities — the brand mechanic. */
export type Valence = 'streak' | 'pulse' | 'drift';

export const DashboardPrefsSchema = z.object({
  skin: z.enum(HEARTBEAT_SKINS).optional(),
  mood: z.enum(MOODS).optional(),
  actionSurface: z.enum(ACTION_SURFACES).optional(),
  motionMode: z.enum(MOTION_MODES).optional(),
  /** Categories to surface. Empty = use defaults. */
  enabledCategories: z.array(z.enum(STREAM_CATEGORIES)).optional(),
  /** Per-category valence override. Missing key = use category default. */
  valenceOverrides: z
    .record(z.enum(STREAM_CATEGORIES), z.enum(['streak', 'pulse', 'drift']))
    .optional(),
  /** Hide stale items older than N days (0 = never hide). */
  staleAfterDays: z.number().int().min(0).max(365).optional(),
  /** Show "time since you opened metu today" anchor in Now-rail. */
  showSessionAnchor: z.boolean().optional(),
  /** User-forced reduced motion (independent of OS setting). */
  manualReducedMotion: z.boolean().optional(),
  /** Ambient drone + per-valence chimes. Default OFF. */
  soundEnabled: z.boolean().optional(),
});

export type DashboardPrefsInput = z.infer<typeof DashboardPrefsSchema>;

export interface DashboardPrefs {
  skin: HeartbeatSkin;
  mood: Mood;
  actionSurface: ActionSurface;
  motionMode: MotionMode;
  enabledCategories: StreamCategory[];
  valenceOverrides: Partial<Record<StreamCategory, Valence>>;
  staleAfterDays: number;
  showSessionAnchor: boolean;
  manualReducedMotion: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  skin: 'constellation',
  mood: 'mystical',
  actionSurface: 'capture',
  motionMode: 'calm',
  enabledCategories: [
    'project_activity',
    'project_age',
    'goals',
    'captures',
    'tasks',
    'integrations',
    'devices',
    'social_posts',
  ],
  valenceOverrides: {},
  staleAfterDays: 60,
  showSessionAnchor: true,
  manualReducedMotion: false,
  soundEnabled: false,
};

/** A single "thing" rendered as a light-object on the heartbeat. */
export interface StreamItem {
  /** Stable id, unique per dashboard render. Used as React key + viewTransitionName seed. */
  id: string;
  /** Source category (drives default valence + grouping). */
  category: StreamCategory;
  /** Time-since polarity. */
  valence: Valence;
  /** Short label (project name, integration label, "Last capture", etc.). */
  label: string;
  /** Optional secondary text (e.g. "@github", "TikTok @handle"). */
  sublabel?: string;
  /** Anchor timestamp — what we measure "time since" from. ISO string. */
  anchorAt: string;
  /** Where clicking this object navigates. */
  href?: string;
  /** Optional accent override (oklch). When unset, derived from valence. */
  accent?: string;
}
