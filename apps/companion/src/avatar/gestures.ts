/**
 * Gesture bus — fire one-shot expressive gestures on the desktop avatar.
 * The main MetuStage (anchor) listens for 'metu:assistant-gesture'.
 */
import type { AvatarGesture } from './types';

export function playGesture(gesture: AvatarGesture, durationMs?: number): void {
  window.dispatchEvent(
    new CustomEvent('metu:assistant-gesture', { detail: { gesture, durationMs } }),
  );
}
