/**
 * Idle/away detection for the companion window. Emits
 *   `device.companion.idle`   when no input for IDLE_MS
 *   `device.companion.active` on next input after idle
 * Listens to mouse + keyboard inside the webview only — Tauri's
 * native global-input is overkill for this signal.
 */
import { useEffect, useRef } from 'react';

const IDLE_MS = 5 * 60_000;

export function useIdleDetection(
  onChange: (state: 'idle' | 'active') => void,
  enabled = true,
): void {
  const stateRef = useRef<'idle' | 'active'>('active');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function go(next: 'idle' | 'active') {
      if (stateRef.current === next) return;
      stateRef.current = next;
      onChange(next);
    }

    function bump() {
      if (timerRef.current) clearTimeout(timerRef.current);
      go('active');
      timerRef.current = setTimeout(() => go('idle'), IDLE_MS);
    }

    bump();
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });

    return () => {
      for (const e of events) window.removeEventListener(e, bump);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, onChange]);
}
