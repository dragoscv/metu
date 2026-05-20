/**
 * Global accelerator for voice capture toggle (default Cmd/Ctrl+Shift+V).
 *
 * Mirrors `usePushToTalkHotkey` but treats every press as a toggle —
 * useful for "hands free" longer dictation sessions where the user
 * doesn't want to hold the key down.
 */
import { useEffect } from 'react';
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';

export interface VoiceCaptureHotkeyOpts {
  accelerator: string;
  onToggle: () => void;
  enabled?: boolean;
}

export function useVoiceCaptureHotkey({
  accelerator,
  onToggle,
  enabled = true,
}: VoiceCaptureHotkeyOpts): void {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let registered = false;

    (async () => {
      try {
        if (await isRegistered(accelerator)) await unregister(accelerator);
        if (cancelled) return;
        await register(accelerator, (ev) => {
          if (ev.state === 'Pressed') onToggle();
        });
        registered = true;
      } catch (err) {
        console.warn('[voice-hotkey] failed to register', accelerator, err);
      }
    })();

    return () => {
      cancelled = true;
      if (registered) {
        unregister(accelerator).catch(() => {});
      }
    };
  }, [accelerator, enabled, onToggle]);
}
