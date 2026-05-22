/* global self, clients */

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};

    try {
      payload = event.data ? event.data.json() : {};
    } catch (_error) {
      const text = event.data ? event.data.text() : '';
      payload = text ? { body: text } : {};
    }

    const title = String(payload.title || 'New message');
    const body = String(payload.body || '');
    const conversationId = payload.conversationId ? String(payload.conversationId) : null;
    const targetUrl = String(payload.url || '/');
    const badgeCount = Number.parseInt(payload.badgeCount, 10);

    await self.registration.showNotification(title, {
      body,
      icon: '/vite.svg',
      badge: '/vite.svg',
      tag: conversationId ? `chat-${conversationId}` : 'chat-message',
      renotify: true,
      data: {
        url: targetUrl,
        conversationId,
      },
    });

    if (typeof self.registration.setAppBadge === 'function') {
      const nextBadge = Number.isInteger(badgeCount) && badgeCount > 0 ? badgeCount : 1;
      await self.registration.setAppBadge(nextBadge).catch(() => undefined);
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const notificationData = event.notification?.data || {};
    const urlFromNotification = String(notificationData.url || '/');
    const targetUrl = new URL(urlFromNotification, self.location.origin).href;

    const windowClients = await clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    for (const client of windowClients) {
      const sameOrigin = client.url.startsWith(self.location.origin);
      if (!sameOrigin) continue;

      client.postMessage({
        type: 'chat-notification-click',
        conversationId: notificationData.conversationId || null,
      });

      await client.focus();
      return;
    }

    if (clients.openWindow) {
      await clients.openWindow(targetUrl);
    }
  })());
});
