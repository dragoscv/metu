/**
 * Mobile push notifications — Expo + metu SDK push register.
 *
 * Lazy-imports `expo-notifications` (the same dormant-infrastructure
 * pattern used by `wake-word.ts`) so this file stays typecheck-green
 * until the user runs `pnpm install` to fetch the package. After install,
 * the hook flow is:
 *
 *   1. Probe `Notifications.getPermissionsAsync()`; if not granted, ask.
 *   2. Resolve the EAS projectId from `Constants.expoConfig?.extra?.eas?.projectId`
 *      (set via `eas init` / EAS Build env). Without it, Expo's push
 *      service cannot mint a token; we surface that as `error: 'no_eas_project_id'`.
 *   3. Call `Notifications.getExpoPushTokenAsync({ projectId })`.
 *   4. POST `{ channel: 'expo', payload: { token } }` to
 *      `/api/sdk/v1/push/register` (bearer-auth, `notify:read` scope).
 *   5. Subscribe to foreground / response listeners; the response handler
 *      deep-links via `Linking.openURL` if the notification carries
 *      `data.url`.
 *
 * Foreground display behaviour (banner + sound + badge) is set globally
 * via `Notifications.setNotificationHandler({...})`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { api, getFingerprint, getToken } from './api';

let warnedMissing = false;

interface NotificationsModule {
  setNotificationHandler: (handler: {
    handleNotification: () => Promise<{
      shouldShowAlert: boolean;
      shouldPlaySound: boolean;
      shouldSetBadge: boolean;
    }>;
  }) => void;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getExpoPushTokenAsync: (opts: { projectId: string }) => Promise<{ data: string }>;
  addNotificationReceivedListener: (cb: (n: unknown) => void) => { remove: () => void };
  addNotificationResponseReceivedListener: (
    cb: (r: { notification: { request: { content: { data: Record<string, unknown> } } } }) => void,
  ) => { remove: () => void };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'awaiting-permission' }
  | { kind: 'denied' }
  | { kind: 'registering' }
  | { kind: 'registered'; token: string }
  | { kind: 'error'; error: string };

async function loadNotifications(): Promise<NotificationsModule | null> {
  try {
    // Lazy-imported optional peer dep. The cast keeps this file typechecking
    // even when `expo-notifications` has not yet been installed.
    const mod = (await import('expo-notifications')) as NotificationsModule;
    return mod;
  } catch (err) {
    if (!warnedMissing) {
      warnedMissing = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[push] expo-notifications not installed — run `pnpm --filter @metu/mobile add expo-notifications` and rebuild the dev client.',
        err,
      );
    }
    return null;
  }
}

function projectIdFromConstants(): string | null {
  // Lazy-resolve via Constants so we don't pull `expo-constants` at module
  // load time; it's already a transitive dep of expo so the require works.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require('expo-constants').default as {
      expoConfig?: { extra?: { eas?: { projectId?: string } } };
      easConfig?: { projectId?: string };
    };
    return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
  } catch {
    return null;
  }
}

export function useRegisterPush() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const modRef = useRef<NotificationsModule | null>(null);

  // Set the global notification handler + tap responder once the module
  // resolves. Both listeners are torn down on unmount.
  useEffect(() => {
    let receivedSub: { remove: () => void } | null = null;
    let responseSub: { remove: () => void } | null = null;

    void (async () => {
      const mod = await loadNotifications();
      modRef.current = mod;
      if (!mod) {
        setStatus({ kind: 'unavailable', reason: 'expo-notifications not installed' });
        return;
      }
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      receivedSub = mod.addNotificationReceivedListener(() => {
        // No-op: the global handler already controls UX. Hook can be
        // extended later to mark in-app state.
      });
      responseSub = mod.addNotificationResponseReceivedListener((r) => {
        const data = r.notification?.request?.content?.data ?? {};
        const url = typeof data.url === 'string' ? data.url : null;
        if (url) {
          void Linking.openURL(url);
        }
      });
    })();

    return () => {
      receivedSub?.remove();
      responseSub?.remove();
    };
  }, []);

  const register = useCallback(async () => {
    const mod = modRef.current;
    if (!mod) {
      setStatus({ kind: 'unavailable', reason: 'expo-notifications not installed' });
      return;
    }
    if (!(await getToken())) {
      setStatus({ kind: 'error', error: 'paste your metu API token first' });
      return;
    }

    setStatus({ kind: 'awaiting-permission' });
    const current = await mod.getPermissionsAsync();
    let granted = current.status === 'granted';
    if (!granted) {
      const ask = await mod.requestPermissionsAsync();
      granted = ask.status === 'granted';
    }
    if (!granted) {
      setStatus({ kind: 'denied' });
      return;
    }

    const projectId = projectIdFromConstants();
    if (!projectId) {
      setStatus({ kind: 'error', error: 'no_eas_project_id (run `eas init`)' });
      return;
    }

    setStatus({ kind: 'registering' });
    let token: string;
    try {
      const result = await mod.getExpoPushTokenAsync({ projectId });
      token = result.data;
    } catch (err) {
      setStatus({
        kind: 'error',
        error: err instanceof Error ? err.message : 'getExpoPushTokenAsync failed',
      });
      return;
    }

    // Register the device first so the push subscription can be paired
    // to a `device` row (slice M2). Best-effort — if it fails the push
    // sub still registers without a deviceId.
    let deviceId: string | undefined;
    try {
      const fingerprint = await getFingerprint();
      const reg = await api<{ ok: boolean; deviceId?: string }>('/api/sdk/v1/devices/register', {
        kind: 'mobile',
        platform: Platform.OS,
        name: `metu mobile · ${Platform.OS}`,
        fingerprint,
        capabilities: ['push.expo', 'presence.talk'],
      });
      if (reg.ok && reg.deviceId) deviceId = reg.deviceId;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[push] device register failed, continuing without deviceId', err);
    }

    try {
      await api('/api/sdk/v1/push/register', {
        channel: 'expo',
        deviceId,
        payload: { token },
      });
      setStatus({ kind: 'registered', token });
    } catch (err) {
      setStatus({
        kind: 'error',
        error: err instanceof Error ? err.message : 'register POST failed',
      });
    }
  }, []);

  return { status, register };
}
