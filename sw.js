// Service Worker — odbiór powiadomień push (panel rezerwacji DARD).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'DARD', body: 'Nowe zdarzenie w systemie rezerwacji' };
  try { data = event.data.json(); } catch (e) { /* zostaw domyślne */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/android-chrome-192x192.png',
    badge: '/android-chrome-192x192.png',
    data: { url: '/admin.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.includes('/admin.html') && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow('/admin.html');
  }));
});
