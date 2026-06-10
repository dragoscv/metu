/**
 * Personality presets — these tune *how* the desktop assistant behaves, not
 * what it looks like (that's the avatar selection). The user can switch
 * between them from the main window; the active one is persisted and read by
 * the assistant brain (`useAssistantBrain`) and the message layer.
 *
 * Three personalities, per the product decision:
 *   - calm     → professional, low chatter, slow deliberate motion
 *   - playful  → expressive, chatty, bouncy motion, wanders more
 *   - quiet    → minimal, rarely speaks, stays perched, barely moves
 */

export type PersonalityId = 'calm' | 'playful' | 'quiet';

export interface Personality {
  id: PersonalityId;
  label: string;
  description: string;
  /** Mean ms between autonomous wander hops (jittered ±50%). */
  wanderIntervalMs: number;
  /** Pixels per animation frame when moving (higher = snappier). */
  moveSpeed: number;
  /** 0..1 likelihood the assistant emits an unprompted remark when it has nothing to say. */
  chattiness: number;
  /** Idle ms before the assistant offers a "still there?" nudge. 0 disables. */
  idleNudgeMs: number;
  /** Prefer perching on the active window vs. free wandering. */
  perchBias: number; // 0..1
  /** Bubble auto-dismiss duration (ms). */
  bubbleTtlMs: number;
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  calm: {
    id: 'calm',
    label: 'Calm',
    description: 'Professional and composed. Speaks only when it helps.',
    wanderIntervalMs: 45_000,
    moveSpeed: 6,
    chattiness: 0.15,
    idleNudgeMs: 8 * 60_000,
    perchBias: 0.7,
    bubbleTtlMs: 6_000,
  },
  playful: {
    id: 'playful',
    label: 'Playful',
    description: 'Expressive and lively. Wanders, reacts, and chats often.',
    wanderIntervalMs: 18_000,
    moveSpeed: 12,
    chattiness: 0.55,
    idleNudgeMs: 4 * 60_000,
    perchBias: 0.35,
    bubbleTtlMs: 5_000,
  },
  quiet: {
    id: 'quiet',
    label: 'Quiet',
    description: 'Stays out of the way. Rarely moves, rarely speaks.',
    wanderIntervalMs: 120_000,
    moveSpeed: 4,
    chattiness: 0.03,
    idleNudgeMs: 0,
    perchBias: 0.9,
    bubbleTtlMs: 4_000,
  },
};

export const DEFAULT_PERSONALITY: PersonalityId = 'calm';

const STORAGE_KEY = 'metu.companion.personality';

export function loadPersonality(): PersonalityId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v in PERSONALITIES) return v as PersonalityId;
  } catch {
    /* ignore */
  }
  return DEFAULT_PERSONALITY;
}

export function savePersonality(id: PersonalityId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
    window.dispatchEvent(new CustomEvent('metu:personality', { detail: id }));
  } catch {
    /* ignore */
  }
}

/** Subscribe to personality changes made from any window in this process. */
export function onPersonalityChange(cb: (id: PersonalityId) => void): () => void {
  const handler = (e: Event) => {
    const id = (e as CustomEvent<PersonalityId>).detail;
    if (id in PERSONALITIES) cb(id);
  };
  window.addEventListener('metu:personality', handler);
  // Also react to cross-window changes via storage events.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue && e.newValue in PERSONALITIES) {
      cb(e.newValue as PersonalityId);
    }
  };
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('metu:personality', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
