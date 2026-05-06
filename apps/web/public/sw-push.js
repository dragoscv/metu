/**
 * Service worker — receives web push messages and renders OS-level
 * notifications. Registered by `subscribeWebPush()` in client code.
 *
 * Lives in `public/` so the browser fetches it from the site origin.
 * Keep this file dependency-free — no bundler runs over it.
 */
/* global self */
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'METU', body: event.data.text() };
  }
  const title = payload.title ?? 'METU';
  const opts = {
    body: payload.body ?? '',
    data: { url: payload.url ?? '/', id: payload.id },
    badge: '/icon.svg',
    icon: '/icon.svg',
    tag: payload.id ?? 'metu',
    renotify: payload.urgency === 'critical',
    requireInteraction: payload.urgency === 'critical',
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      for (const w of wins) {
        if (w.url.endsWith(url) && 'focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
