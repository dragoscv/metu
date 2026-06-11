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

export function reportFootOffset(logicalPx: number): void {
  if (Number.isFinite(logicalPx) && logicalPx >= 0 && logicalPx <= 400) {
    footOffsetLogical = logicalPx;
  }
}

/** Physical-px offset (what the window-positioning math needs). */
export function getFootOffsetPhysical(): number {
  return footOffsetLogical * (window.devicePixelRatio || 1);
}
