// Rhythm's service worker. It shows push notifications, handles their Done
// and Snooze buttons, and opens the app when one is tapped. It deliberately
// caches nothing, so a new deploy is never hidden behind an old copy of the app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The worker sends { title, body, url, tag } (see pushPayload in
// backend/src/worker/channels.ts); tag is the notification id, so a retried
// delivery replaces the first one instead of showing twice. Reminders about a
// task also carry taskId, date and two actions: Done and Snooze.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rhythm', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag,
      // Chrome on Android and desktop shows these as buttons. Safari doesn't
      // support them, so on an iPhone a tap opens the app instead.
      actions: data.taskId && Array.isArray(data.actions) ? data.actions : [],
      data: { url: data.url || '/today', taskId: data.taskId, date: data.date },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if ((event.action === 'done' || event.action === 'snooze') && data.taskId) {
    event.waitUntil(handleAction(event.action, data));
    return;
  }
  event.waitUntil(openApp(data.url));
});

/**
 * Done and Snooze, straight from the notification, without opening the app.
 * The request is same-origin, so the session cookie goes with it. Ticking off
 * also updates any open Rhythm screen through its live connection.
 */
async function handleAction(action, data) {
  const done = action === 'done';
  const date = data.date ? { date: data.date } : {};
  try {
    const res = await fetch(`/api/tasks/${data.taskId}/${done ? 'complete' : 'snooze'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(done ? date : { minutes: 15, ...date }),
    });
    if (res.ok) return true;
  } catch {
    // Offline: say so below.
  }
  // Signed out, offline or the task is gone. Don't fail silently: the person
  // thinks it's done. A tap on this one opens the app.
  await self.registration.showNotification('Rhythm', {
    body: "Couldn't save that. Tap to open Rhythm and try there.",
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: `failed-${data.taskId}`,
    data: { url: '/today' },
  });
  return false;
}

/** Focus an open Rhythm tab on that page, or open a new one. */
async function openApp(path) {
  const url = new URL(path || '/today', self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
  if (!open) return self.clients.openWindow(url);
  await open.focus();
  try {
    await open.navigate(url);
  } catch {
    // A tab this worker doesn't control can't be navigated; focusing it is enough.
  }
}

// Browsers sometimes replace a push subscription. Subscribe again and tell
// the API, or reminders would silently stop on this device.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/push/public-key');
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });
    })(),
  );
});
