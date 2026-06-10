/**
 * Sensor bridge — forwards companion ambient events to the hub.
 *
 * Listens for the Rust-side Tauri events emitted by `sensors.rs`:
 *   - `metu://window.changed` → forwarded as `event.device` envelope
 *     with kind `window.changed`.
 *   - `metu://file.changed`   → forwarded as `event.device` envelope
 *     with kind `file.changed`.
 *
 * Persists a "sensors enabled" preference in localStorage. When enabled
 * AND the hub is connected, calls the Rust commands to start the
 * trackers; tears them down on disable. Idempotent.
 *
 * Settings (allowlist / redaction / fs roots) live in localStorage too
 * and are read on start. Editing the settings retriggers the start
 * call so the new config takes effect immediately.
 */
import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from './runtime';

const ENABLED_KEY = 'metu.companion.sensors.enabled.v1';
const SETTINGS_KEY = 'metu.companion.sensors.settings.v1';

export interface SensorSettings {
  /** App names whose window title may leave the device. */
  titleAllowlist: string[];
  /** Regex patterns applied to allowed titles. */
  redactionPatterns: string[];
  /** Absolute paths to watch. */
  fsRoots: string[];
  /** Recursive directory watch (default true). */
  fsRecursive: boolean;
}

const DEFAULT_SETTINGS: SensorSettings = {
  titleAllowlist: [],
  redactionPatterns: [
    // Common secret-looking strings — best-effort, server still re-scrubs.
    '(?i)password',
    '(?i)token=[A-Za-z0-9_-]+',
    '[A-Za-z0-9+/]{40,}={0,2}',
  ],
  fsRoots: [],
  fsRecursive: true,
};

export function loadSensorSettings(): SensorSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SensorSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSensorSettings(s: SensorSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function loadSensorsEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function saveSensorsEnabled(v: boolean) {
  localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
}

interface WindowChanged {
  app: string;
  title: string | null;
  windowId: string;
  bounds: { x: number; y: number; w: number; h: number };
  redacted: boolean;
}

interface FileChanged {
  kind: string;
  paths: string[];
}

/**
 * Wires the Rust sensor events to the hub. Pass `sendEnvelope` from
 * `useHubConnection()` and a stable `enabled`/`settings` pair from the
 * settings UI. Idempotent — calling with the same args is a no-op.
 */
export function useSensorBridge(
  sendEnvelope: (envelope: Record<string, unknown>) => boolean,
  enabled: boolean,
  settings: SensorSettings,
  connectedToHub: boolean,
) {
  const sendRef = useRef(sendEnvelope);
  sendRef.current = sendEnvelope;

  // Listener — independent of enabled flag so events that arrive before
  // a state flip get forwarded.
  useEffect(() => {
    let unWin: UnlistenFn | null = null;
    let unFile: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      // Only listen if Tauri is available (not in browser-only dev mode).
      if (!isTauri()) return;
      unWin = await listen<WindowChanged>('metu://window.changed', (e) => {
        sendRef.current({
          v: 1,
          type: 'event.device',
          kind: 'window.changed',
          payload: e.payload,
        });
      });
      unFile = await listen<FileChanged>('metu://file.changed', (e) => {
        // Throttling for the file watcher could happen here; for now we
        // forward every event and let the server-side observer dedupe.
        sendRef.current({
          v: 1,
          type: 'event.device',
          kind: 'file.changed',
          payload: e.payload,
        });
      });
      if (cancelled) {
        unWin?.();
        unFile?.();
      }
    })();

    return () => {
      cancelled = true;
      unWin?.();
      unFile?.();
    };
  }, []);

  // Tracker lifecycle — start when enabled + hub is open; stop otherwise.
  useEffect(() => {
    let stopped = false;

    const start = async () => {
      try {
        await invoke('device_window_track_start', {
          args: {
            titleAllowlist: settings.titleAllowlist,
            redactionPatterns: settings.redactionPatterns,
          },
        });
      } catch (e) {
        // Capability disabled or platform unsupported — log once.
        console.warn('[sensors] window_track start failed:', e);
      }
      if (settings.fsRoots.length > 0) {
        try {
          await invoke('device_fs_watch_start', {
            args: { roots: settings.fsRoots, recursive: settings.fsRecursive },
          });
        } catch (e) {
          console.warn('[sensors] fs_watch start failed:', e);
        }
      }
    };

    const stop = async () => {
      try {
        await invoke('device_window_track_stop');
      } catch {
        /* ignore */
      }
      try {
        await invoke('device_fs_watch_stop');
      } catch {
        /* ignore */
      }
    };

    if (enabled && connectedToHub) {
      void start();
    } else {
      void stop();
    }

    return () => {
      if (stopped) return;
      stopped = true;
      void stop();
    };
    // Re-run when the user toggles enabled, edits settings, or hub status flips.
  }, [enabled, connectedToHub, settings]);
}
