/**
 * Appearance settings (Jarvis v9) — opacity/glass sliders.
 *
 * avatarOpacity  — ambient desktop avatar opacity (0.4–1.0)
 * windowOpacity  — main window opacity (0.7–1.0)
 * glassIntensity — bubble/panel background alpha multiplier (0.5–1.0)
 *
 * Values broadcast via a window event; the assistant window picks
 * avatar/glass up through localStorage polling on its next mount (both
 * windows share the same origin/localStorage).
 */

export interface Appearance {
  avatarOpacity: number;
  windowOpacity: number;
  glassIntensity: number;
}

const KEY = 'metu.companion.appearance.v1';
const DEFAULTS: Appearance = { avatarOpacity: 1, windowOpacity: 1, glassIntensity: 1 };

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<Appearance>;
    return {
      avatarOpacity: clamp(p.avatarOpacity, 0.4, 1),
      windowOpacity: clamp(p.windowOpacity, 0.7, 1),
      glassIntensity: clamp(p.glassIntensity, 0.5, 1),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function clamp(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1;
  return Math.max(min, Math.min(max, n));
}

export function saveAppearance(patch: Partial<Appearance>): Appearance {
  const next = { ...loadAppearance(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('metu:appearance', { detail: next }));
  applyAppearance(next);
  return next;
}

/** Apply to the CURRENT window via CSS vars (each window applies its own). */
export function applyAppearance(a: Appearance = loadAppearance()): void {
  const root = document.documentElement;
  root.style.setProperty('--avatar-opacity', String(a.avatarOpacity));
  root.style.setProperty('--window-opacity', String(a.windowOpacity));
  root.style.setProperty('--glass-intensity', String(a.glassIntensity));
}

export function onAppearanceChange(cb: (a: Appearance) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<Appearance>).detail);
  // storage event covers cross-window sync (main window slider → assistant).
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY) {
      const a = loadAppearance();
      applyAppearance(a);
      cb(a);
    }
  };
  window.addEventListener('metu:appearance', handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('metu:appearance', handler);
    window.removeEventListener('storage', storageHandler);
  };
}
