/**
 * Foot anchor — the measured distance (logical px) between the assistant
 * window's BOTTOM edge and the rendered character's feet.
 *
 * The physics engine positions the window so the feet touch a platform;
 * a hardcoded offset breaks whenever the stage layout, canvas size,
 * camera, or DPI changes. Instead the active avatar stage MEASURES where
 * the feet project on screen and reports it here; the brain reads it
 * every frame.
 */
let footOffsetLogical = 40; // sensible default until first report

/** User fine-tune (logical px, positive = lift the character up). */
const TUNE_KEY = 'metu.footTuneOffset';
let tuneLogical = 0;
try {
  const raw = localStorage.getItem(TUNE_KEY);
  if (raw !== null) {
    const v = Number(raw);
    if (Number.isFinite(v) && Math.abs(v) <= 80) tuneLogical = v;
  }
} catch {
  // storage unavailable — default 0
}

export function getFootTune(): number {
  return tuneLogical;
}

export function setFootTune(logicalPx: number): void {
  tuneLogical = Math.max(-80, Math.min(80, Math.round(logicalPx)));
  try {
    localStorage.setItem(TUNE_KEY, String(tuneLogical));
  } catch {
    // ignore
  }
}

/** Raw measured offset (logical px), pre-tune — used by the calibration overlay. */
export function getFootOffsetLogical(): number {
  return footOffsetLogical;
}

export function reportFootOffset(logicalPx: number): void {
  if (Number.isFinite(logicalPx) && logicalPx >= 0 && logicalPx <= 400) {
    footOffsetLogical = logicalPx;
    // Auto-calibrate once per app version: the measured offset becomes
    // the trusted baseline after an update (stage layout/camera/geometry
    // changes move the feet) — manual tune persists ON TOP of it, but a
    // stale tune from a previous version's wrong baseline is cleared.
    try {
      // __APP_VERSION__ is a Vite define (compile-time constant).
      const ver = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
      const seenKey = 'metu.footCalibratedVersion';
      if (localStorage.getItem(seenKey) !== ver) {
        localStorage.setItem(seenKey, ver);
        if (Math.abs(tuneLogical) > 20) {
          // A large tune was probably compensating for an OLD bug —
          // reset so the fresh measurement stands on its own.
          tuneLogical = 0;
          localStorage.setItem(TUNE_KEY, '0');
        }
      }
    } catch {
      /* storage unavailable */
    }
  }
}

/** Physical-px offset (what the window-positioning math needs). */
export function getFootOffsetPhysical(): number {
  return (footOffsetLogical + tuneLogical) * (window.devicePixelRatio || 1);
}
