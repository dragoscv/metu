/**
 * "Pin to top" toggle — flips the Tauri window's `alwaysOnTop` so the
 * companion can stay above other windows during a focus session.
 *
 * State persists in localStorage.metu.companion.pinned so reopening
 * the app remembers the user's preference, and we re-apply it once on
 * mount.
 */
import { useCallback, useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const KEY = 'metu.companion.pinned';

export function usePinToTop() {
  const [pinned, setPinned] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });

  // Re-apply persisted state on mount.
  useEffect(() => {
    const w = getCurrentWindow();
    void w.setAlwaysOnTop(pinned).catch(() => {});
    // intentionally omit `pinned` so this only runs once at mount —
    // the toggle path below handles subsequent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(KEY, next ? '1' : '0');
      } catch {
        /* private mode */
      }
      void getCurrentWindow()
        .setAlwaysOnTop(next)
        .catch(() => {});
      return next;
    });
  }, []);

  return { pinned, toggle };
}
