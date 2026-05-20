/**
 * Dashboard sounds — Web Audio synth, no asset files.
 *
 * - One AudioContext, lazily created on first user gesture (browser policy).
 * - Three chimes per valence (streak / pulse / drift) — short FM-ish sine arpeggios.
 * - Optional ambient drone — two detuned sines + slow LFO on filter cutoff.
 *
 * Default OFF. Caller must opt-in via the dashboardPrefs.soundEnabled flag.
 *
 * Why hand-rolled: no asset to ship, themeable later (per-mood scale), and the
 * total source is < 100 lines of Web Audio.
 */
import type { Valence } from './types';

interface SoundCtx {
  ac: AudioContext;
  masterGain: GainNode;
  ambientNodes: {
    osc1: OscillatorNode;
    osc2: OscillatorNode;
    lfo: OscillatorNode;
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null;
}

let ctx: SoundCtx | null = null;

function ensureCtx(): SoundCtx | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;

  const AC: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ac = new AC();
  const masterGain = ac.createGain();
  masterGain.gain.value = 0.6;
  masterGain.connect(ac.destination);
  ctx = { ac, masterGain, ambientNodes: null };
  return ctx;
}

const CHIME_NOTES: Record<Valence, number[]> = {
  // Frequencies in Hz. Streak = ascending major triad (rewarding).
  streak: [523.25, 659.25, 783.99],
  // Pulse = single bright ping with a bell overtone.
  pulse: [880, 1318.51],
  // Drift = soft descending pair (gentle, not punitive).
  drift: [440, 369.99],
};

/** Play a tiny chime for a stream's valence. Safe to call when audio is off — it bails. */
export function playChime(valence: Valence, opts: { volume?: number } = {}): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.ac.state === 'suspended') void c.ac.resume();
  const { ac, masterGain } = c;
  const notes = CHIME_NOTES[valence];
  const volume = opts.volume ?? 0.15;
  const now = ac.currentTime;
  const stepMs = valence === 'streak' ? 90 : valence === 'pulse' ? 0 : 140;
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const gain = ac.createGain();
    const start = now + (i * stepMs) / 1000;
    const dur = valence === 'pulse' ? 0.35 : 0.6;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  });
}

/** Start a soft ambient drone. Idempotent. */
export function startAmbient(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.ambientNodes) return;
  if (c.ac.state === 'suspended') void c.ac.resume();
  const { ac, masterGain } = c;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 0.7;
  const gain = ac.createGain();
  gain.gain.value = 0;
  const osc1 = ac.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 110; // A2
  const osc2 = ac.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 110 * 1.5 * 1.005; // perfect 5th, slightly detuned
  // LFO that wanders the filter cutoff for shimmer
  const lfo = ac.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07; // ~14s cycle
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 350;
  lfo.connect(lfoGain).connect(filter.frequency);
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain).connect(masterGain);
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.04, now + 1.5);
  osc1.start(now);
  osc2.start(now);
  lfo.start(now);
  c.ambientNodes = { osc1, osc2, lfo, filter, gain };
}

export function stopAmbient(): void {
  if (!ctx?.ambientNodes) return;
  const { ac } = ctx;
  const { osc1, osc2, lfo, gain } = ctx.ambientNodes;
  const now = ac.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.5);
  osc1.stop(now + 0.6);
  osc2.stop(now + 0.6);
  lfo.stop(now + 0.6);
  ctx.ambientNodes = null;
}
