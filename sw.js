// Service Worker panelu rezerwacji DARD:
// 1) odbiór powiadomień push,
// 2) pamięć podręczna plików panelu (HTML/CSS/JS/ikony), żeby kolejne otwarcia
//    nie czekały na pobieranie ich z sieci — istotne na słabym połączeniu.
const CACHE = 'dard-panel-v1';

self.addEventListener('install', (event) => {
  // Sam HTML panelu; CSS i JS trafią do pamięci przy pierwszym użyciu — dzięki temu
  // nie trzeba tu powtarzać numerów wersji z admin.html (?v=…) i nic się nie rozjedzie.
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/admin.html'])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Strategia: oddaj z pamięci od razu, a w tle pobierz świeżą wersję na następny raz.
// Panel otwiera się natychmiast, a zmiany wchodzą przy kolejnym wejściu.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // obce domeny (np. Google Analytics)
  if (url.pathname.startsWith('/api/')) return;    // dane pacjentów NIGDY nie trafiają do pamięci

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const fromNetwork = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    });
    if (cached) {
      event.waitUntil(fromNetwork.catch(() => {})); // odświeżenie w tle, błąd sieci nic nie psuje
      return cached;
    }
    return fromNetwork;
  })());
});

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
