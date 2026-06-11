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
  }
}

/** Physical-px offset (what the window-positioning math needs). */
export function getFootOffsetPhysical(): number {
  return (footOffsetLogical + tuneLogical) * (window.devicePixelRatio || 1);
}
