/**
 * Tiny audio confirmation blip — fired when the wake word is detected so
 * the user gets immediate feedback that the companion heard them, even
 * before any visual change. Synthesised with the Web Audio API so we
 * don't have to ship + load an audio asset.
 *
 * Intentionally subtle: 80 ms, ~880 Hz sine, fast attack/decay envelope.
 * Routed through a singleton AudioContext so the browser doesn't spawn
 * a new one per call (some browsers cap context count).
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

export function playWakeBlip(): void {
  const c = getCtx();
  if (!c) return;
  // Some browsers suspend the context until user gesture. The wake event
  // counts as one in practice, but resume defensively.
  if (c.state === 'suspended') void c.resume().catch(() => {});

  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  // Tiny chirp downward — feels alive without sounding alarming.
  osc.frequency.exponentialRampToValueAtTime(660, now + 0.08);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);

  osc.connect(gain).connect(c.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}
