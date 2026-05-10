/**
 * Global push-to-talk accelerator.
 *
 * Uses `@tauri-apps/plugin-global-shortcut`. The plugin only exposes
 * `pressed`/`released` events when the underlying OS sends key-up — works on
 * Windows + macOS + most X11/Wayland setups. Some Linux compositors only
 * fire `pressed`, in which case the hotkey behaves as a tap-to-toggle (the
 * UI button remains the canonical control).
 */
import { useEffect } from 'react';
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';

export interface PushToTalkOpts {
  accelerator: string;
  onPress: () => void;
  onRelease: () => void;
  enabled?: boolean;
}

export function usePushToTalkHotkey({
  accelerator,
  onPress,
  onRelease,
  enabled = true,
}: PushToTalkOpts): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let registered = false;

    (async () => {
      try {
        if (await isRegistered(accelerator)) await unregister(accelerator);
        if (cancelled) return;
        await register(accelerator, (ev) => {
          if (ev.state === 'Pressed') onPress();
          else if (ev.state === 'Released') onRelease();
        });
        registered = true;
      } catch (err) {
        console.warn('[hotkey] failed to register', accelerator, err);
      }
    })();

    return () => {
      cancelled = true;
      if (registered) {
        unregister(accelerator).catch(() => {});
      }
    };
  }, [accelerator, enabled, onPress, onRelease]);
}
