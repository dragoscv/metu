/**
 * Gesture bus — fire one-shot expressive gestures on the desktop avatar.
 * The main MetuStage (anchor) listens for 'metu:assistant-gesture'.
 */
import type { AvatarGesture } from './types';
import type { MetuEmotion } from './metuModel';

export function playGesture(gesture: AvatarGesture, durationMs?: number): void {
  window.dispatchEvent(
    new CustomEvent('metu:assistant-gesture', { detail: { gesture, durationMs } }),
  );
}

/** Fire a face emotion on the desktop avatar (decays back to neutral). */
export function playEmotion(emotion: MetuEmotion, durationMs?: number): void {
  window.dispatchEvent(
    new CustomEvent('metu:assistant-emotion', { detail: { emotion, durationMs } }),
  );
}

/**
 * Natural-language gesture commands — lets the user (or the agent) say
 * "salute" / "take a bow" / "dance" and have the body respond. Returns
 * true when the text matched a gesture (caller skips the LLM round-trip).
 */
const GESTURE_COMMANDS: Array<{ re: RegExp; gesture: AvatarGesture; ms?: number }> = [
  { re: /^(?:salute|salut)\b/i, gesture: 'salute', ms: 2200 },
  { re: /^(?:wave|say hi|hello there)\b/i, gesture: 'wave', ms: 1800 },
  { re: /^(?:bow|take a bow)\b/i, gesture: 'bow', ms: 2000 },
  { re: /^(?:facepalm)\b/i, gesture: 'facepalm', ms: 2200 },
  { re: /^(?:stretch)\b/i, gesture: 'stretch', ms: 2600 },
  { re: /^(?:dance|dansează|danseaza)\b/i, gesture: 'dance', ms: 4000 },
  { re: /^(?:look around)\b/i, gesture: 'look-around', ms: 2400 },
  { re: /^(?:celebrate|party)\b/i, gesture: 'celebrate', ms: 2500 },
  { re: /^(?:nod|say yes)\b/i, gesture: 'nod', ms: 1400 },
  { re: /^(?:shake your head|say no)\b/i, gesture: 'shake', ms: 1400 },
  { re: /^(?:shrug)\b/i, gesture: 'shrug', ms: 1600 },
];

export function tryGestureCommand(text: string): boolean {
  const t = text.trim();
  for (const { re, gesture, ms } of GESTURE_COMMANDS) {
    if (re.test(t)) {
      playGesture(gesture, ms);
      return true;
    }
  }
  return false;
}
