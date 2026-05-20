/**
 * Local "mute observer" flag for the companion.
 *
 * When `muted === true`, ambient observers (focus/idle/sensors/clipboard
 * ring/awareness strip) should suppress their outbound events so the user
 * has a quick "go private" affordance without unpairing.
 *
 * Implemented as a localStorage flag broadcast via a custom DOM event so
 * any subscriber re-renders cheaply. Persists across reloads.
 */
import { useCallback, useEffect, useState } from 'react';

const KEY = 'metu.companion.observerMuted';
const EVT = 'metu:companion:muted-changed';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function isObserverMuted(): boolean {
  return read();
}

export function useObserverMuted() {
  const [muted, setMuted] = useState<boolean>(() => read());

  useEffect(() => {
    function handler() {
      setMuted(read());
    }
    window.addEventListener(EVT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !read();
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new CustomEvent(EVT));
  }, []);

  return { muted, toggle };
}
