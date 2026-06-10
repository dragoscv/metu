/**
 * Cross-window bridge for the highlight overlay. The assistant brain (in the
 * `assistant` window) calls `showHighlight(rect)`, which shows the `overlay`
 * window and emits a Tauri event the overlay view listens for.
 * `hideHighlight()` clears it and hides the window.
 */
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

export const OVERLAY_EVENT = 'metu://overlay-highlight';

export interface HighlightRect {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export async function showHighlight(rect: HighlightRect): Promise<void> {
  try {
    await invoke('presence_overlay_show');
    await emit(OVERLAY_EVENT, rect);
    // Auto-hide after the overlay's own TTL window.
    setTimeout(() => void hideHighlight(), 4_200);
  } catch {
    /* overlay best-effort */
  }
}

export async function hideHighlight(): Promise<void> {
  try {
    await emit(OVERLAY_EVENT, null);
    await invoke('presence_overlay_hide');
  } catch {
    /* ignore */
  }
}
