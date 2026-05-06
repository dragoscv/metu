/**
 * Browser-side helpers for enabling web push.
 *
 * Flow: register service worker → request Notification permission →
 * `pushManager.subscribe()` with the server's VAPID public key →
 * POST subscription JSON to `registerWebPushAction`.
 */
'use client';
import { registerWebPushAction, unsubscribePushAction } from '@/app/actions/notifications';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}

export async function isPushSupported(): Promise<boolean> {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function ensurePushSubscribed(): Promise<
  { ok: true; id: string } | { ok: false; error: string }
> {
  if (!(await isPushSupported())) return { ok: false, error: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, error: 'permission_denied' };

  const reg =
    (await navigator.serviceWorker.getRegistration('/sw-push.js')) ??
    (await navigator.serviceWorker.register('/sw-push.js'));
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch('/api/push/vapid-public-key');
    if (!res.ok) return { ok: false, error: 'vapid_unavailable' };
    const { publicKey } = (await res.json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
  }

  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return registerWebPushAction({ endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(subscriptionId: string): Promise<void> {
  await unsubscribePushAction(subscriptionId);
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  }
}
